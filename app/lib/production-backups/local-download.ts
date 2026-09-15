import { copyBindings, copyRegistry, copySlots, listCopies } from '../local-copies';
import { clearImages } from '../local-database-transfer';
import { migrateRestoredDatabase } from './migrate';
import { prepareSqlForD1Import, schemaFingerprint, splitBackupStatements } from './workflow';

type LocalEnv = Partial<LocalDevelopmentBindings> & { LOCAL_STORAGE_ENABLED?: string };
type FetchBackup = (params: Record<string, string>) => Promise<Response>;
const importBatchSize = 500;

// Only a newly reserved, unpublished local slot may be replaced. Never accept a
// database ID from the browser or use a production binding as an import target.
export async function saveBackupLocally(env: LocalEnv, backupId: string, fetchBackup: FetchBackup) {
  if (env.LOCAL_STORAGE_ENABLED !== 'true' || !env.WORKING_DB || !env.CATALOG_DB) throw new Error('Local database storage is unavailable.');
  if (!/^[a-f0-9-]{36}$/.test(backupId)) throw new Error('Choose a saved backup.');
  let stage = 'preparing the local copy';
  const metadata = await fetchBackup({ download: 'metadata', id: backupId });
  const backup = await metadata.json() as { name: string; schema: string; photos: number };
  if (typeof backup.name !== 'string' || !/^[a-f0-9]{64}$/.test(backup.schema) || !Number.isSafeInteger(backup.photos) || backup.photos < 0) throw new Error('Deploy the backup download update to production first.');
  const registry = await copyRegistry(env.WORKING_DB);
  let slot: string | undefined;
  try {
    for (const candidate of copySlots) {
      if (!copyBindings(env, candidate)) continue;
      const result = await registry.prepare('INSERT OR IGNORE INTO local_database_copies (id,name,created_at,ready) VALUES (?,?,?,0)').bind(candidate, `Backup · ${backup.name}`.slice(0, 80), new Date().toISOString()).run();
      if (result.meta.changes) { slot = candidate; break; }
    }
    if (!slot) throw new Error('All eight local copy slots are in use. Delete an unused local copy first.');
    const target = copyBindings(env, slot)!;
    stage = 'downloading the backup database';
    const sqlResponse = await fetchBackup({ download: 'sql', id: backupId });
    const sql = await sqlResponse.text();
    if (sql.length > 24 * 1024 * 1024) throw new Error('This backup is too large for local import.');
    stage = 'preparing the backup database';
    const statements = splitBackupStatements(prepareSqlForD1Import(sql));
    // The registry shares the first slot. It must never be imported or dropped.
    if (statements.some(statement => /\blocal_database_copies\b/i.test(statement))) throw new Error('The backup contains reserved local metadata.');
    const objects = await target.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('trigger','view','table') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'local_database_copies' ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 ELSE 2 END").all<{ type: string; name: string; sql: string | null }>();
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const tables = objects.results.filter((object) => object.type === 'table');
    const byName = new Map(tables.map((table) => [table.name.toLowerCase(), table]));
    const orderedTables: string[] = [], visiting = new Set<string>(), visited = new Set<string>();
    const visitTable = (name: string) => {
      const key = name.toLowerCase();
      if (visited.has(key) || visiting.has(key)) return;
      visiting.add(key);
      const definition = byName.get(key)?.sql ?? '';
      for (const reference of definition.matchAll(/\bREFERENCES\s+(["`\[]?[^\s(,"`\]]+["`\]]?)/gi)) visitTable(reference[1].replace(/^["`\[]|["`\]]$/g, ''));
      visiting.delete(key); visited.add(key); orderedTables.push(key);
    };
    for (const table of tables) visitTable(table.name);
    const childFirstTables = orderedTables.reverse().map((name) => byName.get(name)!);
    // Clear and drop children before their parents. This avoids depending on a
    // deferred-foreign-key PRAGMA, which local D1 does not reliably retain for
    // the full cleanup batch.
    stage = 'clearing the local copy slot';
    await target.db.batch([
      ...objects.results.filter(o => o.type !== 'table').map(o => target.db.prepare(`DROP ${o.type} ${quote(o.name)}`)),
      ...childFirstTables.map(table => target.db.prepare(`DELETE FROM ${quote(table.name)}`)),
      ...childFirstTables.map(table => target.db.prepare(`DROP TABLE ${quote(table.name)}`)),
    ]);
    // D1 limits the number of statements in a batch. The SQL has already been
    // ordered with parent tables and rows first, so it remains valid when sent
    // in bounded consecutive batches.
    stage = 'importing the backup database';
    for (let start = 0; start < statements.length; start += importBatchSize) {
      await target.db.batch(statements.slice(start, start + importBatchSize).map(statement => target.db.prepare(statement)));
    }
    // The local registry is deliberately excluded from snapshot fingerprints.
    stage = 'verifying the backup schema';
    if (await localFingerprint(target.db) !== backup.schema) throw new Error('The restored backup schema could not be verified.');
    stage = 'checking local schema compatibility';
    if (await localFingerprint(env.CATALOG_DB) !== backup.schema) await migrateRestoredDatabase(env.CATALOG_DB, target.db);
    stage = 'checking backup integrity';
    const checks = await target.db.batch([target.db.prepare('PRAGMA quick_check'), target.db.prepare('PRAGMA foreign_key_check')]);
    if (JSON.stringify(checks[0].results) !== '[{"quick_check":"ok"}]' || checks[1].results.length) throw new Error('The restored database failed integrity checks.');
    stage = 'copying backup photos';
    await clearImages(target.images);
    let cursor = '', copied = 0;
    do {
      const response = await fetchBackup({ download: 'images', id: backupId, cursor });
      const page = await response.json() as { keys: string[]; cursor: string };
      for (const key of page.keys) {
        const image = await fetchBackup({ download: 'image', id: backupId, key });
        await target.images.put(key, image.body, { httpMetadata: { contentType: image.headers.get('Content-Type') ?? 'application/octet-stream' } });
        copied++;
      }
      cursor = page.cursor;
    } while (cursor);
    if (copied !== backup.photos) throw new Error('The backup photo count changed. Retry saving the backup.');
    stage = 'finalizing the local copy';
    await registry.prepare('UPDATE local_database_copies SET ready=1 WHERE id=? AND ready=0').bind(slot).run();
    return { id: slot, copies: await listCopies(registry), photos: copied };
  } catch (error) {
    if (slot) await registry.prepare('DELETE FROM local_database_copies WHERE id=? AND ready=0').bind(slot).run();
    if (error instanceof Error && !/SQL|D1_|sqlite/i.test(error.message)) throw error;
    throw new Error(`Could not restore the backup while ${stage}.`);
  }
}

async function localFingerprint(db: D1Database) {
  // Reuse canonical fingerprint normalization, ignoring local-only bookkeeping.
  return schemaFingerprint(db, true);
}
