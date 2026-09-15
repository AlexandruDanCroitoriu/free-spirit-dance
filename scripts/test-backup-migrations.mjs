import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'fsd-migration-test-'));
try {
  const output = join(directory, 'migrate.mjs');
  await build({ entryPoints: ['app/lib/production-backups/migrate.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm' });
  const { migrateRestoredDatabase } = await import(pathToFileURL(output));
  const migrations = JSON.parse(await readFile('app/lib/production-backups/migrations.generated.json', 'utf8'));
  function database(count) {
    const db = new DatabaseSync(':memory:');
    for (const migration of migrations.slice(0, count)) db.exec(migration.statements.join('\n'));
    db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
    for (const migration of migrations.slice(0, count)) db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(migration.name);
    db.exec('PRAGMA foreign_keys=ON');
    return db;
  }
  function binding(db, fail = false) {
    const execute = (sql, params = []) => {
      const query = db.prepare(sql);
      return { results: query.columns().length ? query.all(...params) : (query.run(...params), []) };
    };
    const prepare = (sql, params = []) => ({ sql, params, bind: (...args) => prepare(sql, args), all: async () => execute(sql, params), first: async () => execute(sql, params).results[0] ?? null });
    return { prepare, async batch(statements) {
      db.exec('BEGIN');
      try {
        for (const statement of statements) {
          if (fail && statement.sql.includes('INSERT INTO d1_migrations')) throw new Error('Simulated failure');
          execute(statement.sql, statement.params);
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } };
  }
  const source = database(migrations.length);
  const restored = database(migrations.length - 3);
  restored.exec("INSERT INTO courses (id,name) VALUES (1,'Restored edits'); INSERT INTO payment_presets (id,name,amount_minor,course_id) VALUES (1,'Preset',100,1); INSERT INTO payment_preset_courses VALUES (1,1,4); UPDATE sqlite_sequence SET seq=90 WHERE name='payment_presets';");
  await migrateRestoredDatabase(binding(source), binding(restored));
  assert.equal(restored.prepare('SELECT name FROM courses').get().name, 'Restored edits');
  assert.equal(restored.prepare('SELECT allowance FROM payment_preset_courses').get().allowance, 4);
  assert.equal(restored.prepare("SELECT seq FROM sqlite_sequence WHERE name='payment_presets'").get().seq, 90);
  restored.exec('UPDATE payment_presets SET amount_minor=0');
  assert.deepEqual(restored.prepare('PRAGMA foreign_key_check').all(), []);
  await migrateRestoredDatabase(binding(source), binding(restored));
  assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n, migrations.length);
  const failed = database(migrations.length - 1);
  await assert.rejects(migrateRestoredDatabase(binding(source), binding(failed, true)), /migration failed/);
  assert.equal(failed.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n, migrations.length - 1);
  await migrateRestoredDatabase(binding(source), binding(failed));
  restored.exec("DELETE FROM d1_migrations WHERE id=2");
  await assert.rejects(migrateRestoredDatabase(binding(source), binding(restored)), /history/);
  assert.equal(source.prepare('SELECT COUNT(*) AS n FROM courses').get().n, 0);
  source.close(); restored.close(); failed.close();
  console.log('PASS: older restores upgrade, preserve edits/allowances/IDs, roll back failures, retry safely and reject unknown history.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
