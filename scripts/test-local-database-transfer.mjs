import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temporary = await mkdtemp(join(tmpdir(), 'fsd-local-transfer-'));
try {
  const output = join(temporary, 'transfer.mjs');
  await build({ stdin: { contents: "export * from './app/lib/local-database-transfer';", resolveDir: process.cwd() }, outfile: output, bundle: true, format: 'esm', platform: 'node', plugins: [{ name: 'storage', setup(context) {
    context.onLoad({ filter: /app\/lib\/storage\.ts$/ }, () => ({ contents: 'export const env = {};', loader: 'ts' }));
  } }] });
  const { copyImages, readTables, replaceDatabase } = await import(pathToFileURL(output));
  async function database() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys=ON');
    for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) sqlite.exec(await readFile(`migrations/${file}`, 'utf8'));
    const prepare = (sql, parameters = []) => ({ sql, parameters, bind(...values) { return prepare(sql, values); }, async all() { return { results: sqlite.prepare(sql).all(...parameters) }; }, async first() { return sqlite.prepare(sql).get(...parameters) ?? null; } });
    return { sqlite, prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map(statement => { const query = sqlite.prepare(statement.sql); return { results: query.columns().length ? query.all(...statement.parameters) : (query.run(...statement.parameters), []) }; }); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  }
  class Bucket { objects = new Map(); async put(key, body, options = {}) { this.objects.set(key, { body: Buffer.from(await new Response(body).arrayBuffer()), ...options }); } async get(key) { const object = this.objects.get(key); return object ? { body: new Response(object.body).body, httpMetadata: object.httpMetadata } : null; } }

  const source = await database(), target = await database(), sourceImages = new Bucket(), targetImages = new Bucket();
  const imageKey = 'free-event-00000000-0000-4000-8000-000000000001.jpg';
  const taskImageKey = 'task-images/00000000-0000-4000-8000-000000000002.jpg';
  source.sqlite.exec(`
    INSERT INTO admin_profiles (email, name) VALUES ('admin@example.test', 'Admin');
    INSERT INTO students (first_name, last_name, email) VALUES ('Student', 'One', '');
    INSERT INTO free_events (name, image_path, created_by, created_at, updated_at) VALUES ('Sunday social', '/api/free-event-images/${imageKey}', 'admin@example.test', '2026-09-17T10:00:00Z', '2026-09-17T10:00:00Z');
    INSERT INTO free_event_meetings (event_id, name, starts_at, starts_utc, duration_minutes, space_rent_minor, accepts_donations, created_by, created_at, updated_at) VALUES (1, 'Week one', '2026-09-20T18:00', '2026-09-20T15:00:00Z', 90, 0, 1, 'admin@example.test', '2026-09-17T10:00:00Z', '2026-09-17T10:00:00Z');
    INSERT INTO free_event_attendance (meeting_id, student_id, recorded_by, recorded_at, donation_amount_minor, donation_received_method) VALUES (1, 1, 'admin@example.test', '2026-09-20T20:00:00Z', 1000, 'cash');
    INSERT INTO free_event_change_log (event_id, administrator_email, action, created_at) VALUES (1, 'admin@example.test', 'created', '2026-09-17T10:00:00Z');
    INSERT INTO free_meeting_change_log (meeting_id, administrator_email, action, created_at) VALUES (1, 'admin@example.test', 'created', '2026-09-17T10:00:00Z');
    INSERT INTO manual_tasks (title, description, sort_order, created_by, created_at, updated_by, updated_at, request_key, request_payload, list_id) VALUES ('Check attachment', '{"type":"doc"}', 0, 'admin@example.test', '2026-09-17T10:00:00Z', 'admin@example.test', '2026-09-17T10:00:00Z', 'task-image-transfer', '{}', 1);
    INSERT INTO task_images (id, task_id, owner_email, object_key, created_at) VALUES ('00000000-0000-4000-8000-000000000002', 1, 'admin@example.test', '${taskImageKey}', '2026-09-17T10:00:00Z');
  `);
  await sourceImages.put(imageKey, 'event-image', { httpMetadata: { contentType: 'image/jpeg' } });
  await sourceImages.put(taskImageKey, 'task-image', { httpMetadata: { contentType: 'image/jpeg' } });
  const tables = await readTables(source);
  await copyImages(sourceImages, targetImages, tables);
  await replaceDatabase(target, tables);
  for (const table of ['free_events', 'free_event_meetings', 'free_event_attendance', 'free_event_change_log', 'free_meeting_change_log']) assert.equal(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 1, `${table} is copied`);
  assert.equal((await targetImages.get(imageKey)).body ? 'event-image' : '', 'event-image');
  assert.equal((await targetImages.get(taskImageKey)).body ? 'task-image' : '', 'task-image');
  assert.equal(target.sqlite.prepare('SELECT object_key FROM task_images').get().object_key, taskImageKey, 'task image record is copied');
  assert.deepEqual(target.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS: local Catalog replacement preserves free events, meetings, attendance, history, and event images.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
