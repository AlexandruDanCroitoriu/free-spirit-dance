import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
const helper = moduleUrl(readFileSync('app/lib/local-copies.ts', 'utf8'));
const exporter = moduleUrl(readFileSync('app/api/administrators/export/route.ts', 'utf8').replace('import { env } from "../../../lib/storage";', 'const env = globalThis.copyTestEnv;'));
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
await productionImages.put('student-test', 'original-image');
globalThis.copyTestEnv = { WORKING_DB: first, WORKING_IMAGES: firstImages, COPY2_DB: second, COPY2_IMAGES: secondImages, CATALOG_DB: catalog, CATALOG_IMAGES: catalogImages, PRODUCTION_DB: production, PRODUCTION_IMAGES: productionImages };
// Reimport after environment initialization: each isolated test module captures its bindings.
const source = readFileSync('app/api/development-copy-production/route.ts', 'utf8').replace('import { env } from "../../lib/storage";', 'const env = globalThis.copyTestEnv;').replace('"../../lib/local-copies"', JSON.stringify(helper)).replace('"../administrators/export/route"', JSON.stringify(exporter));
const api = await import(moduleUrl(source + '\n// initialized'));
const origin = 'https://dev-free-spirit-dance.alexandru-croitoriu.dev';
const request = (method = 'POST', body, email = 'croitoriu.alexandru.code@gmail.com', requestOrigin = origin) => new Request(origin + '/api/development-copy-production', { method, headers: { Origin: requestOrigin, 'cf-access-authenticated-user-email': email }, ...(body ? { body: JSON.stringify(body) } : {}) });
assert.equal((await api.POST(request('POST', null, 'other@example.test'))).status, 403);
assert.equal((await api.POST(request('POST', null, undefined, 'https://bad.example'))).status, 403);
const one = await api.POST(request()); assert.equal(one.status, 200); assert.equal((await one.json()).id, 'working');
assert.deepEqual(first.sqlite.prepare('SELECT email,method FROM administrator_payment_methods ORDER BY email,method').all(), production.sqlite.prepare('SELECT email,method FROM administrator_payment_methods ORDER BY email,method').all());
first.sqlite.exec("UPDATE students SET first_name='Edited locally'");
await firstImages.put('student-test', 'local-image');
const two = await api.POST(request()); assert.equal(two.status, 200); assert.equal((await two.json()).id, 'copy2');
assert.equal(first.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Edited locally');
assert.equal(second.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Source');
assert.equal(production.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Source');
assert.equal(firstImages.items.get('student-test'), 'local-image');
assert.equal(secondImages.items.get('student-test'), 'original-image');
const catalogCopy = await api.PUT(request('PUT', { source: 'working' })); assert.equal(catalogCopy.status, 200);
assert.equal(catalog.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Edited locally');
assert.equal(catalogImages.items.get('student-test'), 'local-image');
assert.equal((await api.PATCH(request('PATCH', { id: 'copy2', name: 'September review' }))).status, 200);
assert.equal((await api.PATCH(request('PATCH', { id: 'copy2', name: ' ' }))).status, 400);
assert.equal(first.sqlite.prepare("SELECT name FROM local_database_copies WHERE id='copy2'").get().name, 'September review');
for (const db of [production, first, second]) assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
console.log('PASS: copies preserve previous edits and production, isolate images, validate names and enforce owner/origin checks.');

globalThis.copyTestEnv.CATALOG_IMAGES = bucket();
const uploader = await import(moduleUrl(readFileSync('app/api/administrators/replace-production/route.ts', 'utf8').replace('import { env } from "../../../lib/storage";', 'const env = globalThis.copyTestEnv;').replace('"../../../lib/local-copies"', JSON.stringify(helper)).replace('"../export/route"', JSON.stringify(exporter))));
const { tableColumns } = await import(exporter);
const tables = Object.entries(tableColumns).map(([name, columns]) => ({ name, columns, rows: first.sqlite.prepare(`SELECT ${columns.join(',')} FROM ${name}`).all() }));
const uploadRequest = new Request(origin + '/api/administrators/replace-production', { method: 'POST', headers: { Origin: origin, 'cf-access-authenticated-user-email': 'croitoriu.alexandru.code@gmail.com' }, body: JSON.stringify({ source: 'working', tables }) });
assert.equal((await uploader.POST(uploadRequest)).status, 200);
assert.equal(production.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Edited locally');
assert.equal(second.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Source');
assert.equal(productionImages.items.get('student-test'), 'local-image');
assert.deepEqual(production.sqlite.prepare('SELECT email,method FROM administrator_payment_methods ORDER BY email,method').all(), first.sqlite.prepare('SELECT email,method FROM administrator_payment_methods ORDER BY email,method').all());
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
assert.equal(first.sqlite.prepare('SELECT COUNT(*) n FROM local_database_copies').get().n, 1);
assert.equal(second.sqlite.prepare('SELECT COUNT(*) n FROM students').get().n, 1);
assert.equal(production.sqlite.prepare('SELECT COUNT(*) n FROM students').get().n, 1);
assert.equal((await api.POST(request())).status, 200, 'Deleted slot can be reused');
console.log('PASS: deletion protects Catalog, production and other copies, clears images, resets selection and frees the slot.');
