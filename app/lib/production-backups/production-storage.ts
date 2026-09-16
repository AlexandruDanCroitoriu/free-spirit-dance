import { prefixedImages } from './cloud';

// This routing record is committed in the same transaction as restored data.
// Staging photos under a fresh prefix never overwrites the live photos.
export const storageTable = '_fsd_production_storage';
export const storageSchema = `CREATE TABLE IF NOT EXISTS ${storageTable} (id INTEGER PRIMARY KEY CHECK (id = 1), restore_job TEXT NOT NULL, image_prefix TEXT NOT NULL)`;

export async function productionStorage(db: D1Database) {
  const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(storageTable).first();
  return exists ? db.prepare(`SELECT restore_job, image_prefix FROM ${storageTable} WHERE id = 1`).first<{ restore_job: string; image_prefix: string }>() : null;
}

export async function productionImages(db: D1Database, bucket: R2Bucket) {
  const prefix = (await productionStorage(db))?.image_prefix;
  if (prefix) return prefixedImages(bucket, prefix);
  // Before the first successful restore the live keys are at the bucket root.
  // Failed staging attempts must not become part of that live image listing.
  return new Proxy(bucket, { get(target, property) {
    if (property === 'then') return undefined;
    if (property === 'list') return async (options?: R2ListOptions) => {
      const result = await target.list(options);
      return { ...result, objects: result.objects.filter(object => !object.key.startsWith('restores/')), delimitedPrefixes: result.delimitedPrefixes?.filter(value => !value.startsWith('restores/')) ?? [] };
    };
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
