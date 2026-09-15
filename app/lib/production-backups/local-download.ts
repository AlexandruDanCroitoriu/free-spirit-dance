import { copyBindings, copyRegistry, copySlots, listCopies } from '../local-copies';
import { clearImages } from '../local-database-transfer';
import { migrateRestoredDatabase } from './migrate';
import { prepareSqlForD1Import, schemaFingerprint, splitBackupStatements } from './workflow';

type LocalEnv = Partial<LocalDevelopmentBindings> & { LOCAL_STORAGE_ENABLED?: string };
type FetchBackup = (params: Record<string, string>) => Promise<Response>;

// Only a newly reserved, unpublished local slot may be replaced. Never accept a
// database ID from the browser or use a production binding as an import target.
export async function saveBackupLocally(env: LocalEnv, backupId: string, fetchBackup: FetchBackup) {
  if (env.LOCAL_STORAGE_ENABLED !== 'true' || !env.WORKING_DB || !env.CATALOG_DB) throw new Error('Local database storage is unavailable.');
  if (!/^[a-f0-9-]{36}$/.test(backupId)) throw new Error('Choose a saved backup.');
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
    const sqlResponse = await fetchBackup({ download: 'sql', id: backupId });
    const sql = await sqlResponse.text();
    if (sql.length > 24 * 1024 * 1024) throw new Error('This backup is too large for local import.');
    const statements = splitBackupStatements(prepareSqlForD1Import(sql));
    // The registry shares the first slot. It must never be imported or dropped.
    if (statements.some(statement => /\blocal_database_copies\b/i.test(statement))) throw new Error('The backup contains reserved local metadata.');
    const objects = await target.db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('trigger','view','table') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'local_database_copies' ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 ELSE 2 END").all<{ type: string; name: string }>();
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    // Empty all tables before dropping them, avoiding FK cascades into tables
    // already dropped. Deferral and the complete restore share one transaction.
    await target.db.batch([
      target.db.prepare('PRAGMA defer_foreign_keys=ON'),
      ...objects.results.filter(o => o.type !== 'table').map(o => target.db.prepare(`DROP ${o.type} ${quote(o.name)}`)),
      ...objects.results.filter(o => o.type === 'table').map(o => target.db.prepare(`DELETE FROM ${quote(o.name)}`)),
      ...objects.results.filter(o => o.type === 'table').map(o => target.db.prepare(`DROP TABLE ${quote(o.name)}`)),
      ...statements.map(statement => target.db.prepare(statement)),
    ]);
    // The local registry is deliberately excluded from snapshot fingerprints.
    if (await localFingerprint(target.db) !== backup.schema) throw new Error('The restored backup schema could not be verified.');
    if (await localFingerprint(env.CATALOG_DB) !== backup.schema) await migrateRestoredDatabase(env.CATALOG_DB, target.db);
    const checks = await target.db.batch([target.db.prepare('PRAGMA quick_check'), target.db.prepare('PRAGMA foreign_key_check')]);
    if (JSON.stringify(checks[0].results) !== '[{"quick_check":"ok"}]' || checks[1].results.length) throw new Error('The restored database failed integrity checks.');
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
    await registry.prepare('UPDATE local_database_copies SET ready=1 WHERE id=? AND ready=0').bind(slot).run();
    return { id: slot, copies: await listCopies(registry), photos: copied };
  } catch (error) {
    if (slot) await registry.prepare('DELETE FROM local_database_copies WHERE id=? AND ready=0').bind(slot).run();
    throw error;
  }
}

async function localFingerprint(db: D1Database) {
  // Reuse canonical fingerprint normalization, ignoring local-only bookkeeping.
  return schemaFingerprint(db, true);
}
