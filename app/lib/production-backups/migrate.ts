import migrations from './migrations.generated.json';

async function history(db: D1Database) {
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").first();
  if (!table) throw new Error('This backup needs a verified migration baseline before it can be upgraded.');
  const rows = await db.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{ name: string }>();
  const names = rows.results.map(row => row.name);
  if (names.some((name, index) => migrations[index]?.name !== name)) throw new Error('Migration history is incomplete or newer than this application.');
  return names;
}

// Run only against a restored working database, never the snapshot or source.
export async function migrateRestoredDatabase(source: D1Database, restored: D1Database) {
  const target = await history(source);
  const current = await history(restored);
  if (current.length > target.length) throw new Error('The restored copy is newer than production. Downgrades are not supported.');
  const pending = migrations.slice(current.length, target.length);
  // Legacy rebuilds assumed foreign_keys=OFF, which D1 cannot honor. Stop
  // before changing anything rather than replaying those data migrations.
  if (pending.some(migration => migration.statements.some(sql => /PRAGMA\s+foreign_keys\s*=\s*(?:OFF|0)/i.test(sql)))) {
    throw new Error('This older backup requires a reviewed legacy migration before activation.');
  }
  for (const migration of pending) {
    try {
      await restored.batch([
        ...migration.statements.map(sql => restored.prepare(sql)),
        restored.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(migration.name),
      ]);
    } catch {
      throw new Error(`Restored copy migration failed: ${migration.name}. The copy is retained for retry.`);
    }
  }
}
