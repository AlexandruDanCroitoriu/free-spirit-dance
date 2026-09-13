export const copySlots = ["working", "copy2", "copy3", "copy4", "copy5", "copy6", "copy7", "copy8"] as const;
export type LocalCopy = { id: string; name: string; createdAt: string };
export function copyBindings(bindings: object, id: string): { db: D1Database; images: R2Bucket } | null {
  if (!copySlots.includes(id as typeof copySlots[number])) return null;
  const prefix = id === "working" ? "WORKING" : id.toUpperCase();
  const db = Reflect.get(bindings, `${prefix}_DB`) as D1Database | undefined;
  const images = Reflect.get(bindings, `${prefix}_IMAGES`) as R2Bucket | undefined;
  return db && images ? { db, images } : null;
}
export async function copyRegistry(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS local_database_copies (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0)").run();
  return db;
}
export async function listCopies(db: D1Database): Promise<LocalCopy[]> {
  await copyRegistry(db);
  return (await db.prepare("SELECT id, name, created_at AS createdAt FROM local_database_copies WHERE ready=1 ORDER BY created_at, id").all<LocalCopy>()).results;
}
