import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source, { mode: 'transform' })).toString('base64');
const cloud = moduleUrl(readFileSync('app/lib/production-backups/cloud.ts', 'utf8'));
const productionStorage = moduleUrl(readFileSync('app/lib/production-backups/production-storage.ts', 'utf8').replace("'./cloud'", JSON.stringify(cloud)));
const helper = moduleUrl(readFileSync('app/lib/local-copies.ts', 'utf8'));
const exporter = moduleUrl(readFileSync('app/api/administrators/export/route.ts', 'utf8').replace(/"(?:\.\.\/)+lib\/production-backups\/production-storage"/, JSON.stringify(productionStorage)).replace('import { env } from "../../../lib/storage";', 'const env = globalThis.copyTestEnv;'));
const transfer = moduleUrl(readFileSync('app/lib/local-database-transfer.ts', 'utf8').replace('"../api/administrators/export/route"', JSON.stringify(exporter)));
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync('migrations/' + name, 'utf8'));
  const db = { sqlite, prepare(sql) {
    let args = [];
    const statement = { bind(...values) { args = values; return statement; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(result.changes) } }; },
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      execute() { const prepared = sqlite.prepare(sql); return { results: prepared.columns().length ? prepared.all(...args) : (prepared.run(...args), []) }; }
    }; return statement;
  }, async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } }; return db;
}
const bucket = () => { const items = new Map(); return { items, async get(key) { return items.has(key) ? { body: items.get(key), httpMetadata: {} } : null; }, async put(key, value) { items.set(key, value); }, async list({ limit }) { return { objects: [...items.keys()].slice(0, limit).map(key => ({ key })) }; }, async delete(keys) { for (const key of keys) items.delete(key); } }; };
const production = database(), first = database(), second = database(), catalog = database();
const productionImages = bucket(), firstImages = bucket(), secondImages = bucket(), catalogImages = bucket();
production.sqlite.exec("INSERT INTO students (first_name,last_name,email,picture) VALUES ('Source','Student','','/api/student-images/student-test')");
production.sqlite.exec("INSERT INTO admin_profiles (email,name) VALUES ('collector@example.test','Collector'); INSERT INTO administrator_payment_methods (email,method) VALUES ('collector@example.test','Transfer')");
production.sqlite.exec("INSERT INTO admin_profiles (email,name) VALUES ('owner@example.test','Owner'); INSERT INTO payment_transfer_filters (administrator_email,collector_email,collector_emails,from_date,to_date,payment_kind,payment_types,sort_order,created_at) VALUES ('owner@example.test','collector@example.test','[\"collector@example.test\"]','2026-09-01','2026-09-30','course','course',1,'2026-09-01T00:00:00.000Z')");
production.sqlite.exec("CREATE TABLE history_absences (student_id TEXT, course_id TEXT, class_date TEXT, start_time TEXT); INSERT INTO history_absences VALUES ('1','1','2026-09-02','19:00')");
production.sqlite.exec("INSERT INTO manual_tasks (title,sort_order,created_by,created_at,updated_by,updated_at,request_key,request_payload) VALUES ('Preserve this task',3,'owner@example.test','2026-09-15','owner@example.test','2026-09-15','copy-task-request-key','{}')");
production.sqlite.exec("INSERT INTO task_students(task_id,student_id) VALUES (1,1)");
await productionImages.put('student-test', 'original-image');
globalThis.copyTestEnv = { WORKING_DB: first, WORKING_IMAGES: firstImages, COPY2_DB: second, COPY2_IMAGES: secondImages, CATALOG_DB: catalog, CATALOG_IMAGES: catalogImages, PRODUCTION_DB: production, PRODUCTION_IMAGES: productionImages };
// Reimport after environment initialization: each isolated test module captures its bindings.
const source = readFileSync('app/api/development-copy-production/route.ts', 'utf8').replace(/"(?:\.\.\/)+lib\/production-backups\/production-storage"/, JSON.stringify(productionStorage)).replace('import { env } from "../../lib/storage";', 'const env = globalThis.copyTestEnv;').replace('"../../lib/local-copies"', JSON.stringify(helper)).replace('"../administrators/export/route"', JSON.stringify(exporter)).replace('"../../lib/local-database-transfer"', JSON.stringify(transfer));
const api = await import(moduleUrl(source + '\n// initialized'));
const origin = 'https://dev-free-spirit-dance.alexandru-croitoriu.dev';
const request = (method = 'POST', body, email = 'croitoriu.alexandru.code@gmail.com', requestOrigin = origin) => new Request(origin + '/api/development-copy-production', { method, headers: { Origin: requestOrigin, 'cf-access-authenticated-user-email': email }, ...(body ? { body: JSON.stringify(body) } : {}) });
assert.equal((await api.POST(request('POST', null, 'other@example.test'))).status, 403);
assert.equal((await api.POST(request('POST', null, undefined, 'https://bad.example'))).status, 403);
const one = await api.POST(request()); assert.equal(one.status, 200); assert.equal((await one.json()).id, 'working');
assert.deepEqual(first.sqlite.prepare('SELECT email,method FROM administrator_payment_methods ORDER BY email,method').all(), production.sqlite.prepare('SELECT email,method FROM administrator_payment_methods ORDER BY email,method').all());
assert.deepEqual(first.sqlite.prepare('SELECT administrator_email,collector_email,collector_emails,from_date,to_date,payment_types FROM payment_transfer_filters').all(), production.sqlite.prepare('SELECT administrator_email,collector_email,collector_emails,from_date,to_date,payment_types FROM payment_transfer_filters').all());
assert.equal(first.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'history_absences'").get(), undefined);
first.sqlite.exec("UPDATE students SET first_name='Edited locally'");
await firstImages.put('student-test', 'local-image');
const two = await api.POST(request()); assert.equal(two.status, 200); assert.equal((await two.json()).id, 'copy2');
assert.equal(first.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Edited locally');
assert.equal(second.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Source');
assert.equal(production.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Source');
assert.equal(firstImages.items.get('student-test'), 'local-image');
assert.equal(secondImages.items.get('student-test'), 'original-image');
catalog.sqlite.exec("INSERT INTO admin_profiles (email,name) VALUES ('catalog@example.test','Catalog'); INSERT INTO students (id,first_name,last_name,email,phone) VALUES (99,'Catalog','Student','',''); INSERT INTO courses (id,name) VALUES (99,'Catalog course'); INSERT INTO classes (id,course_id,class_date,start_time) VALUES (99,99,'2026-09-01','19:00'); INSERT INTO student_payments (id,student_id,paid_on,amount_minor,recorded_by,recorded_at,request_key,request_payload) VALUES (99,99,'2026-09-01',0,'catalog@example.test','2026-09-01T00:00:00.000Z','catalog-audit-payment','{}'); INSERT INTO attendance (id,student_id,course_id,course_name,attended_at,recorded_by,class_id) VALUES (99,99,99,'Catalog course','2026-09-01T19:00:00','catalog@example.test',99); CREATE TABLE group_sheet_audit (sheet TEXT, source_cell TEXT, source_json TEXT NOT NULL, student_id INTEGER REFERENCES students(id), class_id INTEGER REFERENCES classes(id), decision TEXT NOT NULL, attendance_id INTEGER REFERENCES attendance(id), absence_rowid INTEGER, payment_evidence TEXT NOT NULL, payment_decision TEXT NOT NULL, payment_id INTEGER REFERENCES student_payments(id), PRIMARY KEY(sheet,source_cell)); INSERT INTO group_sheet_audit (sheet,source_cell,source_json,student_id,class_id,decision,attendance_id,payment_evidence,payment_decision,payment_id) VALUES ('old','A1','{}',99,99,'old',99,'old','old',99)");
const catalogCopy = await api.PUT(request('PUT', { source: 'working' })); assert.equal(catalogCopy.status, 200);
assert.equal(catalog.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Edited locally');
assert.equal(catalogImages.items.get('student-test'), 'local-image');
assert.equal(catalog.sqlite.prepare('SELECT COUNT(*) n FROM group_sheet_audit').get().n, 0);
assert.deepEqual(catalog.sqlite.prepare('SELECT administrator_email,collector_email,collector_emails,from_date,to_date,payment_types FROM payment_transfer_filters').all(), first.sqlite.prepare('SELECT administrator_email,collector_email,collector_emails,from_date,to_date,payment_types FROM payment_transfer_filters').all());
assert.equal(catalog.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'history_absences'").get(), undefined);
assert.equal((await api.PATCH(request('PATCH', { id: 'copy2', name: 'September review' }))).status, 200);
assert.equal((await api.PATCH(request('PATCH', { id: 'copy2', name: ' ' }))).status, 400);
assert.equal(first.sqlite.prepare("SELECT name FROM local_database_copies WHERE id='copy2'").get().name, 'September review');
for (const db of [production, first, second]) assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
console.log('PASS: copies preserve previous edits and production, isolate images, validate names and enforce owner/origin checks.');

globalThis.copyTestEnv.CATALOG_IMAGES = bucket();
const uploader = await import(moduleUrl(readFileSync('app/api/administrators/replace-production/route.ts', 'utf8').replace(/"(?:\.\.\/)+lib\/production-backups\/production-storage"/, JSON.stringify(productionStorage)).replace('import { env } from "../../../lib/storage";', 'const env = globalThis.copyTestEnv;').replace('"../../../lib/local-copies"', JSON.stringify(helper)).replace('"../export/route"', JSON.stringify(exporter))));
const { tableColumns } = await import(exporter);
const tables = Object.entries(tableColumns).map(([name, columns]) => ({ name, columns, rows: first.sqlite.prepare(`SELECT ${columns.join(',')} FROM ${name}`).all() }));
const uploadRequest = new Request(origin + '/api/administrators/replace-production', { method: 'POST', headers: { Origin: origin, 'cf-access-authenticated-user-email': 'croitoriu.alexandru.code@gmail.com' }, body: JSON.stringify({ source: 'working', tables }) });
assert.equal((await uploader.POST(uploadRequest)).status, 200);
assert.equal(production.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Edited locally');
assert.equal(second.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Source');
assert.equal(productionImages.items.get('student-test'), 'local-image');
assert.deepEqual(production.sqlite.prepare('SELECT email,method FROM administrator_payment_methods ORDER BY email,method').all(), first.sqlite.prepare('SELECT email,method FROM administrator_payment_methods ORDER BY email,method').all());
assert.deepEqual(production.sqlite.prepare('SELECT administrator_email,collector_email,collector_emails,from_date,to_date,payment_types FROM payment_transfer_filters').all(), first.sqlite.prepare('SELECT administrator_email,collector_email,collector_emails,from_date,to_date,payment_types FROM payment_transfer_filters').all());
assert.deepEqual(production.sqlite.prepare('SELECT * FROM manual_tasks').all(), first.sqlite.prepare('SELECT * FROM manual_tasks').all());
assert.deepEqual(production.sqlite.prepare('SELECT * FROM task_students').all(), first.sqlite.prepare('SELECT * FROM task_students').all());
console.log('PASS: explicit upload uses the selected copy images and targets production only.');
assert.equal((await api.DELETE(request('DELETE', { id: 'catalog' }))).status, 400);
assert.equal((await api.DELETE(request('DELETE', { id: 'working' }, 'other@example.test'))).status, 403);
const deletion = request('DELETE', { id: 'working' });
deletion.headers.set('Cookie', 'fsd-storage=working');
const removed = await api.DELETE(deletion);
assert.equal(removed.status, 200);
assert.match(removed.headers.get('Set-Cookie'), /fsd-storage=catalog/);
assert.equal(first.sqlite.prepare('SELECT COUNT(*) n FROM students').get().n, 0);
assert.equal(firstImages.items.size, 0);
assert.equal(first.sqlite.prepare('SELECT COUNT(*) n FROM manual_tasks').get().n, 0);
assert.equal(production.sqlite.prepare('SELECT COUNT(*) n FROM manual_tasks').get().n, 1);
assert.equal(first.sqlite.prepare('SELECT COUNT(*) n FROM local_database_copies').get().n, 1);
assert.equal(second.sqlite.prepare('SELECT COUNT(*) n FROM students').get().n, 1);
assert.equal(production.sqlite.prepare('SELECT COUNT(*) n FROM students').get().n, 1);
assert.equal((await api.POST(request())).status, 200, 'Deleted slot can be reused');
console.log('PASS: deletion protects Catalog, production and other copies, clears images, resets selection and frees the slot.');
