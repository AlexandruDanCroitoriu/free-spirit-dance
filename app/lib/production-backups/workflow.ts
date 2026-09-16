import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { cloudApi, workingDatabase } from "./cloud";
import { productionImages, productionStorage, storageSchema, storageTable } from "./production-storage";
import type { Backup, Job } from "./model";
import { migrateRestoredDatabase } from "./migrate";

type Transfer = { status?: string; success?: boolean; at_bookmark?: string; upload_url?: string; filename?: string; result?: { signed_url?: string }; error?: string; messages?: string[] };

// D1 exports each table followed by its rows. Its import endpoint can enforce a
// foreign key while it is still reading rows for a table whose referenced table
// appears later in the dump. Recreate the normal SQLite dump order instead:
// all tables, then all rows, then indexes/triggers/views.
export function splitBackupStatements(source: string) {
  const statements: string[] = [];
  let start = 0, quote = '', comment = '', tokens: string[] = [], depth = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (comment === 'line') { if (char === '\n') comment = ''; continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; index++; } continue; }
    if (quote) {
      if (char === quote) {
        if (next === quote && quote !== ']') index++;
        else quote = '';
      }
      continue;
    }
    if (char === '-' && next === '-') { comment = 'line'; index++; continue; }
    if (char === '/' && next === '*') { comment = 'block'; index++; continue; }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      quote = char === '[' ? ']' : char;
      tokens.push('quoted');
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const word = /^[A-Za-z_0-9]+/.exec(source.slice(index))![0];
      index += word.length - 1;
      const token = word.toUpperCase();
      tokens.push(token);
      const trigger = tokens[0] === 'CREATE' && (tokens[1] === 'TRIGGER' || (['TEMP', 'TEMPORARY'].includes(tokens[1]) && tokens[2] === 'TRIGGER'));
      if (trigger && (token === 'BEGIN' || token === 'CASE')) depth++;
      if (trigger && token === 'END') depth--;
      continue;
    }
    if (char === ';' && depth === 0) {
      if (tokens.length) statements.push(source.slice(start, index + 1).trim());
      start = index + 1;
      tokens = [];
    } else if (!/\s/.test(char) && char !== ';') tokens.push(char);
  }
  if (quote || comment === 'block' || tokens.length || depth) throw new Error('Incomplete SQL statement');
  return statements;
}

export function prepareSqlForD1Import(source: string) {
  const statements = splitBackupStatements(source);
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

export async function schemaFingerprint(db: D1Database, local = false) {
  const result = await db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND substr(name, 1, 4) != '_cf_' AND substr(name, 1, 7) != 'sqlite_' AND name != '${storageTable}' ${local ? "AND name != 'local_database_copies'" : ''} ORDER BY type, name`).all();
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

export async function replaceProductionDatabase(db: D1Database, source: string, jobId: string, imagePrefix: string) {
  const sql = prepareSqlForD1Import(source);
  const objects = await db.prepare("SELECT type, name FROM sqlite_master WHERE sql IS NOT NULL AND substr(name, 1, 4) != '_cf_' AND substr(name, 1, 7) != 'sqlite_' AND type IN ('trigger', 'view', 'table') ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 ELSE 2 END").all<{ type: string; name: string }>();
  const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  const tables = objects.results.filter(row => row.type === 'table').map(row => row.name);
  const references = tables.length ? await db.batch<{ table: string }>(tables.map(name => db.prepare(`PRAGMA foreign_key_list(${quote(name)})`))) : [];
  const parents = new Map(tables.map((name, index) => [name, references[index].results.map(row => row.table)]));
  const visited = new Set<string>(), visiting = new Set<string>(), ordered: string[] = [];
  const visit = (name: string) => {
    if (visited.has(name) || !parents.has(name)) return;
    if (visiting.has(name)) throw new Error('Cyclic table dependencies require a reviewed production restore.');
    visiting.add(name);
    for (const parent of parents.get(name)!) if (parent !== name) visit(parent);
    visiting.delete(name); visited.add(name); ordered.push(name);
  };
  tables.forEach(visit);
  // RESTRICT foreign keys fire immediately, even when deferred. Drop children
  // first and remove application triggers before SQLite performs implicit deletes.
  await db.batch([
    db.prepare('PRAGMA defer_foreign_keys = ON'),
    ...objects.results.filter(row => row.type !== 'table').map(row => db.prepare(`DROP ${row.type.toUpperCase()} ${quote(row.name)}`)),
    ...ordered.reverse().map(name => db.prepare(`DROP TABLE ${quote(name)}`)),
    ...splitBackupStatements(sql).map(statement => db.prepare(statement)),
    db.prepare(storageSchema),
    db.prepare(`INSERT OR REPLACE INTO ${storageTable} (id, restore_job, image_prefix) VALUES (1, ?, ?)`).bind(jobId, imagePrefix),
  ]);
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
    const copyImages = async (source: R2Bucket, sourcePrefix: string, targetPrefix: string, target: R2Bucket = bucket) => {
      let cursor: string | undefined;
      let photos = 0, bytes = 0;
      for (let page = 0; ; page++) {
          const copied = await step.do(`copy ${targetPrefix}images page ${page}`, config, async () => {
          const list = await source.list({ prefix: sourcePrefix, cursor, limit: 100 });
          let size = 0;
          for (const object of list.objects) {
            const image = await source.get(object.key);
            if (!image || image.etag !== object.etag) throw new Error("A source image changed during backup.");
            const result = await target.put(targetPrefix + object.key.slice(sourcePrefix.length), image.body, { httpMetadata: image.httpMetadata, customMetadata: image.customMetadata });
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
    const exportSql = async (sourceId: string, destination: string) => {
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
      return sql;
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
      const sourceImages = active ? bucket : await productionImages(this.env.DB, this.env.STUDENT_IMAGES);
      const imagePrefix = active ? `working/${active.id}/` : "";
        const schema = await step.do(`${destination}record database schema`, () => schemaFingerprint(sourceDb));
        const sql = await exportSql(sourceId, destination);
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
    const restoreProduction = async (databaseId: string, imagePrefix: string) => {
      const destination = `temporary/${job.backupId}/${job.id}/production/`;
      const targetPrefix = `restores/${job.id}/`;
      await exportSql(databaseId, destination);
      await copyImages(bucket, imagePrefix, targetPrefix, this.env.STUDENT_IMAGES);
      await step.do("reserve production replacement", () => coordinator.beginProductionRestore(job.id));
      await step.do("replace FS-Dance-Db atomically", config, async () => {
        if ((await productionStorage(this.env.DB))?.restore_job === job.id) return;
        const object = await bucket.get(`${destination}database.sql`);
        if (!object || object.size > 24 * 1024 * 1024) throw new Error("Restored SQL is missing or too large.");
        // Schema, rows and photo routing commit together in one transaction.
        await replaceProductionDatabase(this.env.DB, await object.text(), job.id, targetPrefix);
      });
    };
    try {
      // A lost completion response must not repeat the replacement or safety backup.
      if ((await productionStorage(this.env.DB))?.restore_job === job.id) {
        await coordinator.finish(job.id);
        return;
      }
      if (job.kind === "normalize") {
        await drain();
        const safety = await step.do<Backup>('reserve safety backup', () => coordinator.safetyBackup(job.id));
        if (safety.status !== "ready") await snapshot(`snapshots/${safety.id}/`, safety.id);
        const active = await step.do<Backup>('load current live database', () => coordinator.backup(job.backupId));
        if (!active.databaseId || !active.workingReady) throw new Error('Current live database is unavailable.');
        await step.do('verify current live database', async () => {
          const db = workingDatabase(this.env, active.databaseId!);
          if (await schemaFingerprint(db) !== await schemaFingerprint(this.env.DB)) throw new Error('Migrate both database schemas before moving live production.');
          const checks = await db.batch([db.prepare("PRAGMA quick_check"), db.prepare("PRAGMA foreign_key_check")]);
          if (JSON.stringify(checks[0].results) !== '[{"quick_check":"ok"}]' || checks[1].results.length) throw new Error('Current live database failed integrity checks.');
        });
        await restoreProduction(active.databaseId, `working/${active.id}/`);
      } else if (job.kind === "backup") {
        await drain();
        if (job.sourceBackupId) await cloneSnapshot();
        else await snapshot(prefix);
      } else if (job.kind === "activate") {
        await drain();
        if (!job.readOnly) {
          const safety = await step.do<Backup>('reserve safety backup', () => coordinator.safetyBackup(job.id));
          if (safety.status !== "ready") await snapshot(`snapshots/${safety.id}/`, safety.id);
        }
        if (job.sourceBackupId) await cloneSnapshot();
        const backup = await step.do<Backup>("load backup", () => coordinator.backup(job.backupId));
        // Automatic snapshots never resume edits from a previous activation.
        // The outgoing production snapshot has already completed above.
        if (backup.category === 'automatic') {
          backup.workingReady = false;
          await step.do('reset automatic restore readiness', () => coordinator.updateBackup(job.id, { workingReady: false }));
          for (let page = 0; ; page++) {
            const removed = await step.do(`clear automatic working photos ${page}`, config, async () => {
              const objects = await bucket.list({ prefix: workingPrefix, limit: 100 });
              if (objects.objects.length) await bucket.delete(objects.objects.map(o => o.key));
              return objects.objects.length;
            });
            if (!removed) break;
          }
        }
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
        if (job.readOnly) await step.do("activate working copy", () => coordinator.switchDatabase(job.id, job.backupId));
        else await restoreProduction(databaseId, workingPrefix);
      } else if (job.kind === "return") {
        await drain();
        const previous = await step.do<{ readOnly: boolean; target: string }>('read return target', async () => {
          const value = await coordinator.status();
          return { readOnly: Boolean(value.readOnly), target: value.readOnly ? value.previewPrevious ?? 'production' : 'production' };
        });
        if (!previous.readOnly) {
          const safety = await step.do<Backup>('reserve safety backup', () => coordinator.safetyBackup(job.id));
          if (safety.status !== "ready") await snapshot(`snapshots/${safety.id}/`, safety.id);
        }
        await step.do("activate original production", () => coordinator.switchDatabase(job.id, previous.target));
      } else {
        const backup = await step.do<Backup>("load expired backup", () => coordinator.backup(job.backupId));
        const preserveProduction = await step.do('check deletion storage ownership', async () => await coordinator.preserveProductionOnDelete(job.id));
        if (backup.databaseId && !preserveProduction) await step.do("delete inactive working database", config, async () => {
          if (backup.databaseId === this.env.BACKUP_PRODUCTION_DATABASE_ID) throw new Error("Cannot delete original production.");
          // A retried delete may encounter an already-deleted database.
          const databases = await cloudApi<Array<{ uuid: string }>>(this.env, `?name=${encodeURIComponent(`fsd-backup-${backup.id}`)}`, undefined, "GET");
          if (databases.some(d => d.uuid === backup.databaseId)) await cloudApi(this.env, `/${backup.databaseId}`, undefined, "DELETE");
        });
        for (const target of [prefix, ...(preserveProduction ? [] : [workingPrefix]), `temporary/${job.backupId}/`]) {
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
      await step.do("finish job", config, async () => {
        await coordinator.finish(job.id);
        return { finished: true };
      });
    } catch (error) {
      // cloudApi deliberately redacts provider responses. Keep its concise status
      // message so administrators can distinguish a missing permission from an
      // interrupted export or import without exposing credentials or signed URLs.
      const reason = error instanceof Error && error.message ? error.message.replace(/[\r\n]+/g, " ").slice(0, 240) : "Backup workflow failed.";
      await step.do("record failure and resume application", config, async () => {
        await coordinator.finish(job.id, true, reason);
        return { finished: true };
      });
      throw new Error(`Production backup operation failed (${job.kind}).`);
    }
  }
}
