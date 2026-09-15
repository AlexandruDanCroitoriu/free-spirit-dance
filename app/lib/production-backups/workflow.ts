import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { cloudApi, workingDatabase } from "./cloud";
import type { Backup, Job } from "./model";
import { migrateRestoredDatabase } from "./migrate";

type Transfer = { status?: string; success?: boolean; at_bookmark?: string; upload_url?: string; filename?: string; result?: { signed_url?: string }; error?: string; messages?: string[] };

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
    // The original dump's transaction surrounds table-by-table output. After
    // separating schemas from rows, its COMMIT would otherwise run before the
    // rows and immediately enforce their foreign keys.
    if (/^(?:BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE|TRANSACTION))?|COMMIT(?:\s+TRANSACTION)?|END(?:\s+TRANSACTION)?|ROLLBACK(?:\s+TRANSACTION)?)\s*;?$/.test(sql)) continue;
    if (/^PRAGMA\s+(?:FOREIGN_KEYS|DEFER_FOREIGN_KEYS)\b/.test(sql)) continue;
    if (/^CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:VIRTUAL\s+)?TABLE\b/.test(sql)) schema.push(statement);
    else if (/^(?:INSERT|UPDATE|DELETE|REPLACE)\b/.test(sql)) data.push(statement);
    else if (/^CREATE\s+(?:UNIQUE\s+)?(?:INDEX|TRIGGER|VIEW)\b/.test(sql)) finalization.push(statement);
    else leading.push(statement);
  }
  const identifier = (value: string) => value.replace(/^["`\[]|["`\]]$/g, "").toLowerCase();
  const createdTable = (statement: string) => /CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(["`\[]?[^\s("`\]]+["`\]]?)/i.exec(statement)?.[1];
  const insertedTable = (statement: string) => /^(?:INSERT|REPLACE)\s+(?:OR\s+\w+\s+)?INTO\s+(["`\[]?[^\s("`\]]+["`\]]?)/i.exec(statement.trim())?.[1];
  const definitions = new Map<string, string>();
  for (const statement of schema) {
    const table = createdTable(statement);
    if (table) definitions.set(identifier(table), statement);
  }
  const rows = new Map<string, string[]>();
  const otherData: string[] = [];
  for (const statement of data) {
    const table = insertedTable(statement);
    if (!table) otherData.push(statement);
    else (rows.get(identifier(table)) ?? rows.set(identifier(table), []).get(identifier(table))!).push(statement);
  }
  const orderedTables: string[] = [], visiting = new Set<string>(), visited = new Set<string>();
  const visit = (table: string) => {
    if (visited.has(table) || visiting.has(table)) return;
    visiting.add(table);
    const definition = definitions.get(table) ?? "";
    for (const reference of definition.matchAll(/\bREFERENCES\s+(["`\[]?[^\s(,"`\]]+["`\]]?)/gi)) visit(identifier(reference[1]));
    visiting.delete(table); visited.add(table); orderedTables.push(table);
  };
  for (const table of definitions) visit(table[0]);
  const orderedData = [...orderedTables.flatMap((table) => rows.get(table) ?? []), ...otherData, ...[...rows].filter(([table]) => !visited.has(table)).flatMap(([, statements]) => statements)];
  // D1 owns the import transaction and rejects explicit BEGIN/COMMIT. Rows are
  // therefore ordered so every referenced table is present before its children.
  return [...leading, ...schema, ...orderedData, ...finalization].join("\n");
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
          const copied = await step.do(`copy ${targetPrefix}images page ${page}`, config, async () => {
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
    const snapshot = async (destination: string, safetyId?: string) => {
      const status = await step.do<{ active: string; backups: Backup[] }>(`${destination}capture active source`, async () => {
        const value = await coordinator.status();
        return { active: value.readOnly ? value.previewPrevious ?? 'production' : value.active, backups: value.backups };
      });
      const active = status.active === "production" ? null : status.backups.find(b => b.id === status.active);
      const sourceId = active?.databaseId ?? this.env.BACKUP_PRODUCTION_DATABASE_ID;
      if (active && !active.databaseId) throw new Error("Active database is unavailable.");
      const sourceDb = active ? workingDatabase(this.env, sourceId) : this.env.DB;
      const sourceImages = active ? bucket : this.env.STUDENT_IMAGES;
      const imagePrefix = active ? `working/${active.id}/` : "";
        const schema = await step.do(`${destination}record database schema`, () => schemaFingerprint(sourceDb));
        let transfer = await step.do(`${destination}start SQL export`, config, () => cloudApi<Transfer>(this.env, `/${sourceId}/export`, { output_format: "polling" }));
        for (let poll = 0; !transfer.result?.signed_url; poll++) {
          if (transfer.status === "error" || transfer.success === false || !transfer.at_bookmark || poll >= 300) throw new Error("SQL export did not complete.");
          const bookmark = transfer.at_bookmark;
          await step.sleep(`${destination}wait for export ${poll}`, "1 second");
          transfer = await step.do(`${destination}poll export ${poll}`, config, () => cloudApi<Transfer>(this.env, `/${sourceId}/export`, { output_format: "polling", current_bookmark: bookmark }));
        }
        const sql = await step.do(`${destination}save SQL snapshot`, config, async () => {
          const response = await fetch(transfer.result!.signed_url!);
          if (!response.ok || !response.body) throw new Error("Could not download SQL export.");
          const object = await bucket.put(`${destination}database.sql`, response.body, { httpMetadata: { contentType: "application/sql" } });
          if (!object.size) throw new Error("SQL export was empty.");
          return { bytes: object.size, etag: object.etag };
        });
        const images = await copyImages(sourceImages, imagePrefix, `${destination}images/`);
        await step.do(`${destination}complete snapshot`, config, async () => {
          await bucket.put(`${destination}manifest.json`, JSON.stringify({ version: 1, sourceDatabaseId: sourceId, createdAt: job.startedAt, schema, sql, ...images }));
          await coordinator.updateBackup(job.id, { schema, bytes: sql.bytes + images.bytes, photos: images.photos, status: "ready" }, safetyId);
        });
    };
    const cloneSnapshot = async () => {
          const original = await step.do<Backup>('load source snapshot', () => coordinator.backup(job.sourceBackupId!));
          await step.do('copy snapshot SQL', config, async () => {
            const sql = await bucket.get(`snapshots/${original.id}/database.sql`);
            if (!sql) throw new Error('Source snapshot is missing.');
            const saved = await bucket.put(`${prefix}database.sql`, sql.body);
            if (!saved || saved.etag !== sql.etag) throw new Error('Snapshot checksum mismatch.');
          });
          await copyImages(bucket, `snapshots/${original.id}/images/`, `${prefix}images/`);
          await step.do('finish manual copy', async () => {
            await coordinator.updateBackup(job.id, { schema: original.schema, bytes: original.bytes, photos: original.photos, status: 'ready' });
          });
    };
    try {
      if (job.kind === "backup") {
        await drain();
        if (job.sourceBackupId) await cloneSnapshot();
        else await snapshot(prefix);
      } else if (job.kind === "activate") {
        await drain();
        if (!job.readOnly) {
          const safety = await step.do<Backup>('reserve safety backup', () => coordinator.safetyBackup(job.id));
          await snapshot(`snapshots/${safety.id}/`, safety.id);
        }
        if (job.sourceBackupId) await cloneSnapshot();
        const backup = await step.do<Backup>("load backup", () => coordinator.backup(job.backupId));
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
            // The import API validates the checksum of the SQL we uploaded,
            // which is the reordered import file, not the original snapshot.
            return { etag: prepared.etag, filename: transfer.filename };
          });
          let transfer = await step.do("start import", config, () => cloudApi<Transfer>(this.env, `/${databaseId}/import`, { action: "ingest", ...upload }));
          for (let poll = 0; transfer.status !== "complete"; poll++) {
            if (transfer.status === "error" || transfer.success === false) throw new Error(`SQL import failed: ${transfer.error ?? transfer.messages?.join(" ") ?? "Cloudflare did not provide a reason."}`);
            if (!transfer.at_bookmark) throw new Error("SQL import did not start.");
            if (poll >= 300) throw new Error("SQL import timed out after five minutes.");
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
        if (databaseId === this.env.BACKUP_PRODUCTION_DATABASE_ID) throw new Error("Cannot modify original production.");
        await drain();
        await step.do("upgrade restored working copy", config, async () => {
          const db = workingDatabase(this.env, databaseId);
          if (await schemaFingerprint(db) !== await schemaFingerprint(this.env.DB)) await migrateRestoredDatabase(this.env.DB, db);
        });
        await step.do("verify schema at switch", config, async () => {
          const db = workingDatabase(this.env, databaseId);
          if (await schemaFingerprint(this.env.DB) !== await schemaFingerprint(db)) throw new Error("Database schema changed or the restored schema is incompatible. Activation cancelled.");
          const checks = await db.batch([db.prepare("PRAGMA quick_check"), db.prepare("PRAGMA foreign_key_check")]);
          if (JSON.stringify(checks[0].results) !== '[{"quick_check":"ok"}]' || checks[1].results.length) throw new Error("Migrated database integrity verification failed.");
        });
        await step.do("activate working copy", () => coordinator.switchDatabase(job.id, job.backupId));
      } else if (job.kind === "return") {
        await drain();
        const previous = await step.do<{ readOnly: boolean; target: string }>('read return target', async () => {
          const value = await coordinator.status();
          return { readOnly: Boolean(value.readOnly), target: value.readOnly ? value.previewPrevious ?? 'production' : 'production' };
        });
        if (!previous.readOnly) {
          const safety = await step.do<Backup>('reserve safety backup', () => coordinator.safetyBackup(job.id));
          await snapshot(`snapshots/${safety.id}/`, safety.id);
        }
        await step.do("activate original production", () => coordinator.switchDatabase(job.id, previous.target));
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
