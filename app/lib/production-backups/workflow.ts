import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { cloudApi, workingDatabase } from "./cloud";
import type { Backup, Job } from "./model";

type Transfer = { status?: string; success?: boolean; at_bookmark?: string; upload_url?: string; filename?: string; result?: { signed_url?: string }; error?: string };

// D1 exports each table followed by its rows. Its import endpoint can enforce a
// foreign key while it is still reading rows for a table whose referenced table
// appears later in the dump. Recreate the normal SQLite dump order instead:
// all tables, then all rows, then indexes/triggers/views.
export function prepareSqlForD1Import(source: string) {
  const statements: string[] = [];
  let start = 0;
  let quote = "";
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) { if (character === "\n") lineComment = false; continue; }
    if (blockComment) { if (character === "*" && next === "/") { blockComment = false; index += 1; } continue; }
    if (quote) {
      if (character === quote) {
        if (next === quote && quote !== "]") { index += 1; continue; }
        quote = "";
      }
      continue;
    }
    if (character === "-" && next === "-") { lineComment = true; index += 1; continue; }
    if (character === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (character === "'" || character === '"' || character === "`") { quote = character; continue; }
    if (character === "[") { quote = "]"; continue; }
    if (character === ";") {
      const beforeSemicolon = source.slice(start, index);
      // Trigger bodies contain ordinary statement semicolons. Their outer
      // statement finishes only at END;.
      if (/^\s*CREATE\s+TRIGGER\b/i.test(beforeSemicolon) && !/\bEND\s*$/i.test(beforeSemicolon)) continue;
      const statement = `${beforeSemicolon};`.trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const last = source.slice(start).trim();
  if (last) statements.push(last.endsWith(";") ? last : `${last};`);
  const schema: string[] = [], data: string[] = [], finalization: string[] = [], leading: string[] = [];
  for (const statement of statements) {
    const sql = statement.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, "").toUpperCase();
    if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:VIRTUAL\s+)?TABLE\b/.test(sql)) schema.push(statement);
    else if (/^(?:INSERT|UPDATE|DELETE|REPLACE)\b/.test(sql)) data.push(statement);
    else if (/^CREATE\s+(?:UNIQUE\s+)?(?:INDEX|TRIGGER|VIEW)\b/.test(sql)) finalization.push(statement);
    else leading.push(statement);
  }
  return [...leading, ...schema, ...data, ...finalization].join("\n");
}

export async function schemaFingerprint(db: D1Database) {
  const result = await db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND substr(name, 1, 4) != '_cf_' AND substr(name, 1, 7) != 'sqlite_' ORDER BY type, name").all();
  // SQLite exports may add identifier quotes and whitespace. Compare SQL
  // tokens rather than the spelling of the original CREATE statement.
  const normalized = result.results.map(row => {
    const record = row as { type: string; name: string; tbl_name: string; sql: string };
    const tokens = record.sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|[^\s]/g) ?? [];
    const sql = tokens.filter(token => token !== ";").map(token => {
      if (token.startsWith("'")) return token;
      if (["\"", "`", "["].includes(token[0])) return token.slice(1, -1).replaceAll('""', '"').replaceAll("``", "`").toLowerCase();
      return token.toLowerCase();
    });
    return { type: record.type, name: record.name, table: record.tbl_name, sql };
  });
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2,"0")).join("");
}
export class ProductionBackupWorkflow extends WorkflowEntrypoint<CloudflareEnv, Job> {
  async run(event: WorkflowEvent<Job>, step: WorkflowStep) {
    const job = event.payload;
    const coordinator = this.env.PRODUCTION_BACKUPS.getByName("production");
    const bucket = this.env.BACKUP_BUCKET;
    const prefix = `snapshots/${job.backupId}/`;
    const workingPrefix = `working/${job.backupId}/`;
    const config = { retries: { limit: 3, delay: "2 seconds" as const, backoff: "exponential" as const }, timeout: "5 minutes" as const };
    const drain = async () => {
      await step.do("pause application requests", () => coordinator.lock(job.id));
      await step.do("wait for existing requests", { retries: { limit: 60, delay: "2 seconds", backoff: "constant" } }, async () => {
        if (await coordinator.pending()) throw new Error("Waiting for existing requests to finish.");
      });
    };
    const copyImages = async (source: R2Bucket, sourcePrefix: string, targetPrefix: string) => {
      let cursor: string | undefined;
      let photos = 0, bytes = 0;
      for (let page = 0; ; page++) {
        const copied = await step.do(`copy images page ${page}`, config, async () => {
          const list = await source.list({ prefix: sourcePrefix, cursor, limit: 100 });
          let size = 0;
          for (const object of list.objects) {
            const image = await source.get(object.key);
            if (!image || image.etag !== object.etag) throw new Error("A source image changed during backup.");
            const result = await bucket.put(targetPrefix + object.key.slice(sourcePrefix.length), image.body, { httpMetadata: image.httpMetadata, customMetadata: image.customMetadata });
            if (result.size !== object.size || result.etag !== object.etag) throw new Error("Image verification failed.");
            size += result.size;
          }
          return { cursor: list.truncated ? list.cursor : null, count: list.objects.length, bytes: size };
        });
        photos += copied.count; bytes += copied.bytes;
        if (!copied.cursor) break;
        cursor = copied.cursor;
      }
      return { photos, bytes };
    };
    try {
      if (job.kind === "backup") {
        await drain();
        const schema = await step.do("record database schema", () => schemaFingerprint(this.env.DB));
        let transfer = await step.do("start SQL export", config, () => cloudApi<Transfer>(this.env, `/${this.env.BACKUP_PRODUCTION_DATABASE_ID}/export`, { output_format: "polling" }));
        for (let poll = 0; !transfer.result?.signed_url; poll++) {
          if (transfer.status === "error" || transfer.success === false || !transfer.at_bookmark || poll >= 300) throw new Error("SQL export did not complete.");
          const bookmark = transfer.at_bookmark;
          await step.sleep(`wait for export ${poll}`, "1 second");
          transfer = await step.do(`poll export ${poll}`, config, () => cloudApi<Transfer>(this.env, `/${this.env.BACKUP_PRODUCTION_DATABASE_ID}/export`, { output_format: "polling", current_bookmark: bookmark }));
        }
        const sql = await step.do("save SQL snapshot", config, async () => {
          const response = await fetch(transfer.result!.signed_url!);
          if (!response.ok || !response.body) throw new Error("Could not download SQL export.");
          const object = await bucket.put(`${prefix}database.sql`, response.body, { httpMetadata: { contentType: "application/sql" } });
          if (!object.size) throw new Error("SQL export was empty.");
          return { bytes: object.size, etag: object.etag };
        });
        const images = await copyImages(this.env.STUDENT_IMAGES, "", `${prefix}images/`);
        await step.do("complete snapshot", config, async () => {
          await bucket.put(`${prefix}manifest.json`, JSON.stringify({ version: 1, sourceDatabaseId: this.env.BACKUP_PRODUCTION_DATABASE_ID, createdAt: job.startedAt, schema, sql, ...images }));
          await coordinator.updateBackup(job.id, { schema, bytes: sql.bytes + images.bytes, photos: images.photos, status: "ready" });
        });
      } else if (job.kind === "activate") {
        const backup = await step.do<Backup>("load backup", () => coordinator.backup(job.backupId));
        await step.do("check schema compatibility", config, async () => {
          if (await schemaFingerprint(this.env.DB) !== backup.schema) throw new Error("Backup schema differs from production. Migrate a separate copy before activating it.");
        });
        if (backup.databaseId && !backup.workingReady) await step.do("discard incomplete previous restore", config, async () => {
          if (backup.databaseId === this.env.BACKUP_PRODUCTION_DATABASE_ID) throw new Error("Cannot modify original production.");
          const existing = await cloudApi<Array<{ uuid: string }>>(this.env, `?name=${encodeURIComponent(`fsd-backup-${backup.id}`)}`, undefined, "GET");
          if (existing.some(d => d.uuid === backup.databaseId)) await cloudApi(this.env, `/${backup.databaseId}`, undefined, "DELETE");
          await coordinator.updateBackup(job.id, { databaseId: undefined, workingReady: false });
        });
        const databaseId = await step.do("create working database", config, async () => {
          if (backup.databaseId && backup.workingReady) return backup.databaseId;
          // Stable name makes a retry safe if creation succeeded before a crash.
          const name = `fsd-backup-${backup.id}`;
          const existing = await cloudApi<Array<{ uuid: string; name: string }>>(this.env, `?name=${encodeURIComponent(name)}`, undefined, "GET");
          const database = existing.find(d => d.name === name) ?? await cloudApi<{ uuid: string }>(this.env, "", { name });
          await coordinator.updateBackup(job.id, { databaseId: database.uuid });
          return database.uuid;
        });
        if (!backup.workingReady) {
          const upload = await step.do("upload SQL for import", config, async () => {
            const object = await bucket.get(`${prefix}database.sql`);
            if (!object || !/^[a-f0-9]{32}$/i.test(object.etag)) throw new Error("Snapshot SQL checksum is unavailable.");
            const sql = await object.text();
            if (sql.length > 24 * 1024 * 1024) throw new Error("Snapshot SQL is too large to prepare for D1 import.");
            const preparedKey = `temporary/${job.backupId}/database.import.sql`;
            const prepared = await bucket.put(preparedKey, prepareSqlForD1Import(sql), { httpMetadata: { contentType: "application/sql" } });
            const transfer = await cloudApi<Transfer>(this.env, `/${databaseId}/import`, { action: "init", etag: prepared.etag });
            if (transfer.upload_url) {
              const preparedObject = await bucket.get(preparedKey);
              if (!preparedObject) throw new Error("Prepared SQL is unavailable.");
              const result = await fetch(transfer.upload_url, { method: "PUT", body: preparedObject.body });
              if (!result.ok) throw new Error("SQL upload failed.");
            }
            if (!transfer.filename) throw new Error("SQL import filename is missing.");
            return { etag: object.etag, filename: transfer.filename };
          });
          let transfer = await step.do("start import", config, () => cloudApi<Transfer>(this.env, `/${databaseId}/import`, { action: "ingest", ...upload }));
          for (let poll = 0; transfer.status !== "complete"; poll++) {
            if (transfer.status === "error" || transfer.success === false || !transfer.at_bookmark || poll >= 300) throw new Error("SQL import did not complete.");
            const bookmark = transfer.at_bookmark;
            await step.sleep(`wait for import ${poll}`, "1 second");
            transfer = await step.do(`poll import ${poll}`, config, () => cloudApi<Transfer>(this.env, `/${databaseId}/import`, { action: "poll", current_bookmark: bookmark }));
          }
          await copyImages(bucket, `${prefix}images/`, workingPrefix);
          await step.do("verify working copy", config, async () => {
            const db = workingDatabase(this.env, databaseId);
            if (await schemaFingerprint(db) !== backup.schema) throw new Error("Restored database schema verification failed.");
            const checks = await db.batch([db.prepare("PRAGMA quick_check"), db.prepare("PRAGMA foreign_key_check")]);
            if (JSON.stringify(checks[0].results) !== '[{"quick_check":"ok"}]' || checks[1].results.length) throw new Error("Restored database integrity verification failed.");
            await coordinator.updateBackup(job.id, { workingReady: true, error: undefined });
          });
          await step.do("remove prepared SQL", () => bucket.delete(`temporary/${job.backupId}/database.import.sql`));
        }
        await drain();
        await step.do("verify schema at switch", config, async () => {
          if (await schemaFingerprint(this.env.DB) !== backup.schema || await schemaFingerprint(workingDatabase(this.env, databaseId)) !== backup.schema) throw new Error("Database schema changed. Activation cancelled.");
        });
        await step.do("activate working copy", () => coordinator.switchDatabase(job.id, job.backupId));
      } else if (job.kind === "return") {
        await drain();
        await step.do("activate original production", () => coordinator.switchDatabase(job.id, "production"));
      } else {
        const backup = await step.do<Backup>("load expired backup", () => coordinator.backup(job.backupId));
        if (backup.databaseId) await step.do("delete inactive working database", config, async () => {
          if (backup.databaseId === this.env.BACKUP_PRODUCTION_DATABASE_ID) throw new Error("Cannot delete original production.");
          // A retried delete may encounter an already-deleted database.
          const databases = await cloudApi<Array<{ uuid: string }>>(this.env, `?name=${encodeURIComponent(`fsd-backup-${backup.id}`)}`, undefined, "GET");
          if (databases.some(d => d.uuid === backup.databaseId)) await cloudApi(this.env, `/${backup.databaseId}`, undefined, "DELETE");
        });
        for (const target of [prefix, workingPrefix, `temporary/${job.backupId}/`]) {
          for (let page = 0; ; page++) {
            const removed = await step.do(`delete ${target} page ${page}`, config, async () => {
              const objects = await bucket.list({ prefix: target, limit: 100 });
              if (objects.objects.length) await bucket.delete(objects.objects.map(o => o.key));
              return objects.objects.length;
            });
            if (!removed) break;
          }
        }
      }
      await step.do("finish job", () => coordinator.finish(job.id));
    } catch (error) {
      // cloudApi deliberately redacts provider responses. Keep its concise status
      // message so administrators can distinguish a missing permission from an
      // interrupted export or import without exposing credentials or signed URLs.
      const reason = error instanceof Error && error.message ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "Backup workflow failed.";
      await step.do("record failure and resume application", () => coordinator.finish(job.id, true, reason));
      throw new Error(`Production backup operation failed (${job.kind}).`);
    }
  }
}
