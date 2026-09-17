import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// Real SQLite constraints/triggers and transactional batches, synthetic data only.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  let beforeMutation = null;
  const db = { sqlite, setBeforeMutation(callback) { beforeMutation = callback; }, prepare(sql) {
    let params = [];
    const statement = { sql, bind(...values) { params = values; return statement; },
      execute() { const query = sqlite.prepare(sql); const results = query.columns().length ? query.all(...params) : (query.run(...params), []); return { results, meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get().n) } }; },
      async first() { return statement.execute().results[0] ?? null; },
      async all() { return statement.execute(); }, async run() { return statement.execute(); },
    }; return statement;
  }, async batch(statements) {
    if (beforeMutation && statements.some(statement => statement.sql === 'UPDATE task_board_state SET revision = ? WHERE id = 1')) {
      const callback = beforeMutation; beforeMutation = null; callback();
    }
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return db;
}

const directory = mkdtempSync(join(tmpdir(), 'fsd-tasks-test-'));
const db = database();
const deletedImages = [];
globalThis.taskTestEnv = { DB: db, STUDENT_IMAGES: { async delete(key) { deletedImages.push(key); } } };
async function load(file, name) {
  const outfile = join(directory, `${name}.mjs`);
  await build({ entryPoints: [file], outfile, bundle: true, format: 'esm', platform: 'node', plugins: [{ name: 'test-storage', setup(context) {
    context.onLoad({ filter: /app\/lib\/storage\.ts$/ }, () => ({ contents: 'export const env = globalThis.taskTestEnv;', loader: 'ts' }));
  } }] });
  return import(pathToFileURL(outfile));
}
const owner = 'croitoriu.alexandru.code@gmail.com';
const admin = 'tasks@example.test';
const origin = 'https://school.test';
function request(method = 'GET', body, options = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: origin, 'cf-access-authenticated-user-email': admin, ...options.headers };
  return new Request(options.url ?? `${origin}/api/tasks`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const context = key => ({ params: Promise.resolve({ key }) });
const revision = () => db.sqlite.prepare('SELECT revision FROM task_board_state WHERE id=1').get().revision;
async function expect(response, status = 200) {
  const result = await response;
  const body = result.status === 204 ? null : await result.json();
  assert.equal(result.status, status, JSON.stringify(body));
  return body;
}
function rows() { return db.sqlite.prepare('SELECT * FROM manual_tasks ORDER BY id').all(); }

try {
  const api = await load('app/api/tasks/route.ts', 'tasks');
  const item = await load('app/api/tasks/[key]/route.ts', 'task');
  const moves = await load('app/api/tasks/move/route.ts', 'move');
  const students = await load('app/api/students/[id]/route.ts', 'student');
  const permissions = await load('app/api/access-permissions/route.ts', 'permissions');
  const administrators = await load('app/api/administrators/[email]/route.ts', 'administrator');
  const domain = await load('app/lib/tasks.ts', 'domain');
  const filters = await load('app/lib/task-filters.ts', 'filters');
  for (const status of ['in_progress', 'done']) {
    const task = { status, source: 'manual', students: [], dueDate: null };
    assert.equal(filters.matchesTask(task, filters.readTaskFilters(new URLSearchParams()), '2026-09-16'), true);
    assert.equal(filters.matchesTask(task, filters.readTaskFilters(new URLSearchParams({ status })), '2026-09-16'), true);
    assert.equal(filters.matchesTask(task, filters.readTaskFilters(new URLSearchParams({ status: status === 'done' ? 'in_progress' : 'done' })), '2026-09-16'), false);
  }
  const transfer = await load('app/lib/local-database-transfer.ts', 'transfer');
  const exporter = await load('app/api/administrators/export/route.ts', 'export');
  const importer = await load('app/api/administrators/import/route.ts', 'import');
  const clear = await load('app/api/administrators/clear-data/route.ts', 'clear');

  db.sqlite.exec(`INSERT INTO administrator_permissions(email,can_tasks) VALUES ('${admin}',1),('denied@example.test',0);
    INSERT INTO students(id,first_name,last_name,email,picture) VALUES (1,'First','Student','','/api/student-images/student-test'),(2,'Second','Student','',NULL);`);
  await expect(api.GET(request('GET', undefined, { headers: { 'cf-access-authenticated-user-email': '' } })), 401);
  await expect(api.GET(request('GET', undefined, { headers: { 'cf-access-authenticated-user-email': 'denied@example.test' } })), 403);
  await expect(api.POST(request('POST', {}, { headers: { 'cf-access-authenticated-user-email': 'denied@example.test' } })), 403);
  const initial = await expect(api.GET(request()));
  assert.equal(initial.revision, revision()); assert.deepEqual(initial.tasks, []);
  assert.equal('columns' in initial, false);
  assert.equal((await api.GET(request())).headers.get('Cache-Control'), 'no-store');
  assert.equal((await expect(permissions.GET(request()))).tasks, true);

  const create = (title, extra = {}) => api.POST(request('POST', { title, revision: revision(), requestKey: `task-create-${title.replaceAll(' ', '-').padEnd(10, 'x')}`, ...extra }));
  const first = await expect(create('First', { studentIds: [1], dueDate: '2026-09-15' }), 201);
  const second = await expect(create('Second'), 201);
  const third = await expect(create('Third', { studentIds: [2] }), 201);
  assert.equal(first.task.key, 'manual:1'); assert.equal(first.task.source, 'manual');
  assert.deepEqual(first.task.students, [{ id: 1, name: 'First Student', picture: '/api/student-images/student-test' }]);
  assert.equal(second.task.dueDate, null); assert.equal(second.task.description, '');
  assert.equal(first.task.createdBy, admin);
  assert.equal((await expect(item.GET(request(), context(first.task.key)))).task.title, 'First');
  await expect(item.GET(request(), context('manual:9999')), 404);
  await expect(item.GET(request(), context('automatic:1')), 400);
  const filtered = await expect(api.GET(request('GET', undefined, { url: `${origin}/api/tasks?studentId=1` })));
  assert.deepEqual(filtered.tasks.map(task => task.key), [first.task.key]);
  await expect(api.GET(request('GET', undefined, { url: `${origin}/api/tasks?studentId=oops` })), 400);

  // A response lost in transit can be retried even after the board has changed.
  const beforeRetry = revision();
  await expect(create('First', { revision: 0, studentIds: [1], dueDate: '2026-09-15' }));
  assert.equal(revision(), beforeRetry); assert.equal(rows().length, 3);
  await expect(create('First', { description: 'Different', studentIds: [1], dueDate: '2026-09-15' }), 409);
  for (const extra of [{ title: '' }, { title: 'x'.repeat(201) }, { description: 'x'.repeat(10001) }, { dueDate: '2026-02-30' }, { dueDate: '2026-13-01' }, { status: 'waiting' }, { studentIds: [-1] }, { studentIds: ['1'] }, {studentIds: null}, {studentIds: 1}, {studentIds: Array(501).fill(1)}, { source: 'automatic' }, { sortOrder: 0 }, { revision: -1 }, { requestKey: 'short' }]) await expect(create('Invalid', extra), 400);
  await expect(create('Missing student', { studentIds: [9999] }), 409);
  assert.equal(rows().length, 3); assert.equal(revision(), beforeRetry, 'Failed FK creation rolls back the guard and profile changes.');
  await expect(api.POST(request('POST', {}, { headers: { Origin: 'https://other.test' } })), 403);
  await expect(api.POST(request('POST', {}, { headers: { Origin: '' } })), 403);
  await expect(api.POST(request('POST', {}, { headers: { 'Content-Type': 'text/plain' } })), 415);
  await expect(api.POST(request('POST', { description: 'x'.repeat(65537) })), 413);
  await expect(api.POST(new Request(`${origin}/api/tasks`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'cf-access-authenticated-user-email': admin }, body: '{' })), 400);

  const patch = (key, fields) => item.PATCH(request('PATCH', { revision: revision(), ...fields }), context(key));
  await expect(patch(first.task.key, { description: 'Call before class', title: 'Updated' }));
  assert.equal(db.sqlite.prepare('SELECT student_id FROM task_students WHERE task_id=1').get().student_id, 1); assert.equal(rows()[0].due_date, '2026-09-15');
  assert.equal(rows()[0].created_at, first.task.createdAt);
  await expect(patch(first.task.key, { studentIds: [], dueDate: null }));
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM task_students WHERE task_id=1').get().n, 0);
  await expect(patch(first.task.key, { studentIds: [1] }));
  assert.equal((await expect(patch(first.task.key, { status: 'done' }))).task.status, 'done');
  assert.equal((await expect(patch(first.task.key, { title: 'Still completed' }))).task.status, 'done', 'Unrelated edits preserve completion');
  assert.equal((await expect(patch(first.task.key, { status: 'in_progress' }))).task.status, 'in_progress');
  const studentContext = { params: Promise.resolve({ id: '1' }) };
  await expect(students.DELETE(request('DELETE', {}), studentContext), 409);
  assert.deepEqual(deletedImages, []);
  assert.throws(() => db.sqlite.exec('DELETE FROM students WHERE id=1'), /FOREIGN KEY/, 'Done tasks still restrict direct student deletion.');

  const move = fields => moves.POST(request('POST', { revision: revision(), ...fields }));
  await expect(move({ key: first.task.key, position: 'top' }));
  const moved = await expect(move({ key: third.task.key, position: 'before', targetKey: first.task.key }));
  assert.deepEqual(moved.tasks.map(task => task.key), [third.task.key, first.task.key, second.task.key], 'A filtered move retains the hidden Second task.');
  await expect(move({ key: first.task.key, position: 'bottom' }));
  await expect(move({ key: second.task.key, position: 'after', targetKey: third.task.key }));
  for (const fields of [
    { key: second.task.key, position: 'before', targetKey: second.task.key },
    { key: second.task.key, position: 'top', targetKey: third.task.key },
    { key: second.task.key, position: 'before' },
    { key: second.task.key, position: ['top'] },
  ]) await expect(move(fields), 400);
  await expect(move({ key: second.task.key, position: 'before', targetKey: first.task.key })); // Different statuses may now share a list.

  // Interleave another writer after the read, before the guarded D1 batch.
  const beforeRace = rows();
  const raceRevision = revision();
  db.setBeforeMutation(() => db.sqlite.exec("UPDATE manual_tasks SET description='Other administrator' WHERE id=2"));
  await expect(move({ key: first.task.key, position: 'top' }), 409);
  assert.equal(revision(), raceRevision + 1);
  assert.deepEqual(rows().map(({ description, ...row }) => row), beforeRace.map(({ description, ...row }) => row), 'Stale move must roll back all position/status writes.');
  assert.equal(rows()[1].description, 'Other administrator');
  await expect(patch(first.task.key, { revision: raceRevision, title: 'Stale edit' }), 409);
  const beforeForeignKey = rows();
  await expect(patch(first.task.key, { studentIds: [9999], title: 'Must roll back' }), 409);
  assert.deepEqual(rows(), beforeForeignKey);

  const linkedMany = await expect(patch(first.task.key, {studentIds: [2, 1, 2]}));
  assert.deepEqual(linkedMany.task.students.map(student => student.id), [1, 2]);
  assert.ok((await expect(api.GET(request('GET', undefined, {url: `${origin}/api/tasks?studentId=2`})))).tasks.some(task => task.key === first.task.key));
  const linksBefore = db.sqlite.prepare('SELECT * FROM task_students ORDER BY task_id, student_id').all();
  await expect(patch(first.task.key, {studentIds: [1, 9999]}), 409);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM task_students ORDER BY task_id, student_id').all(), linksBefore);
  await expect(patch(first.task.key, {studentIds: [1]}));
  // Unlinking, rather than completion, is what permits student deletion.
  await expect(patch(first.task.key, { studentIds: [] }));
  await expect(students.DELETE(request('DELETE', {}), studentContext), 204);
  assert.deepEqual(deletedImages, ['student-test']);
  const beforeDeletedStudent = rows();
  await expect(patch(first.task.key, { studentIds: [1] }), 409);
  assert.deepEqual(rows(), beforeDeletedStudent);
  db.setBeforeMutation(() => db.sqlite.exec('DELETE FROM students WHERE id=2'));
  // Student 2 still has a task: the competing delete itself is rejected.
  await expect(patch(second.task.key, { studentIds: [2] }), 409);
  assert.ok(db.sqlite.prepare('SELECT id FROM students WHERE id=2').get());
  db.sqlite.exec("INSERT INTO students(id,first_name,last_name,email) VALUES (3,'Concurrent','Deletion','')");
  const beforeConcurrentLink = revision();
  db.setBeforeMutation(() => db.sqlite.exec('DELETE FROM students WHERE id=3'));
  await expect(patch(second.task.key, { studentIds: [3] }), 409);
  assert.equal(revision(), beforeConcurrentLink, 'The failed link guard rolls back; student changes no longer generate tasks.');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM task_students WHERE task_id=2').get().n, 0);

  // Existing administrator forms can omit tasks without revoking its grant.
  const permissionBody = { dashboard: false, students: false, courses: false, practiceParties: false, qrCodes: false };
  const adminContext = { params: Promise.resolve({ email: admin }) };
  await expect(administrators.PATCH(request('PATCH', permissionBody), adminContext));
  assert.equal((await expect(permissions.GET(request()))).tasks, true);
  await expect(administrators.PATCH(request('PATCH', { ...permissionBody, tasks: false }), adminContext));
  await expect(api.GET(request()), 403);
  await expect(item.PATCH(request('PATCH', { revision: revision(), title: 'Denied' }), context(first.task.key)), 403);
  await expect(item.DELETE(request('DELETE', { revision: revision() }), context(first.task.key)), 403);
  await expect(moves.POST(request('POST', {})), 403);
  await expect(api.GET(request('GET', undefined, { headers: { 'cf-access-authenticated-user-email': owner } })));
  await expect(api.GET(request('GET', undefined, { url: 'http://localhost/api/tasks', headers: { 'cf-access-authenticated-user-email': '' } })));
  await expect(administrators.PATCH(request('PATCH', { ...permissionBody, tasks: true }), adminContext));

  // Copies preserve task content/links/order; revision tokens belong to the destination.
  const exported = await transfer.readTables(db);
  const copy = database();
  await transfer.replaceDatabase(copy, exported);
  assert.deepEqual(copy.sqlite.prepare('SELECT * FROM manual_tasks ORDER BY id').all(), rows());
  assert.deepEqual(copy.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(copy.sqlite.prepare('SELECT * FROM task_students ORDER BY task_id,student_id').all(), db.sqlite.prepare('SELECT * FROM task_students ORDER BY task_id,student_id').all());
  // Older exports keep their single student relationship after upgrading.
  const legacyColumns = ['id','title','description','due_date','status','student_id','sort_order','created_by','created_at','updated_by','updated_at','request_key','request_payload','list_id','inbox_owner'];
  const oldExport = exported.filter(table => table.name !== 'task_students').map(table => table.name !== 'manual_tasks' ? table : {...table, columns:legacyColumns, rows:table.rows.map(row => ({...row,status:'done',student_id:db.sqlite.prepare('SELECT student_id FROM task_students WHERE task_id=?').get(row.id)?.student_id ?? null}))});
  const oldCopy = database();
  try {
    await transfer.replaceDatabase(oldCopy, oldExport);
    assert.deepEqual(oldCopy.sqlite.prepare('SELECT * FROM task_students ORDER BY task_id,student_id').all(), db.sqlite.prepare('SELECT * FROM task_students ORDER BY task_id,student_id').all());
    assert.equal(oldCopy.sqlite.prepare('PRAGMA table_info(manual_tasks)').all().some(column => column.name === 'status'), true);
    assert.equal(oldCopy.sqlite.prepare("SELECT COUNT(*) AS n FROM manual_tasks WHERE status != 'done'").get().n, 0);
  } finally { oldCopy.sqlite.close(); }
  const copyRevision = copy.sqlite.prepare('SELECT revision FROM task_board_state').get().revision;
  await transfer.replaceDatabase(copy, exported);
  assert.ok(copy.sqlite.prepare('SELECT revision FROM task_board_state').get().revision > copyRevision);
  assert.equal(copy.sqlite.prepare('SELECT can_tasks FROM administrator_permissions WHERE email=?').get(admin).can_tasks, 1);

  const copyRows = copy.sqlite.prepare('SELECT * FROM manual_tasks ORDER BY id').all();
  globalThis.taskTestEnv.DB = copy;
  const exportResponse = await expect(exporter.GET(request('GET', undefined, { headers: { 'cf-access-authenticated-user-email': owner } })));
  assert.ok(exportResponse.tables.some(table => table.name === 'manual_tasks'));
  const legacy = exportResponse.tables.filter(table => !['manual_tasks', 'task_board_state'].includes(table.name));
  await expect(importer.POST(request('POST', { tables: legacy }, { headers: { 'cf-access-authenticated-user-email': owner } })));
  assert.deepEqual(copy.sqlite.prepare('SELECT * FROM manual_tasks ORDER BY id').all(), copyRows);
  await expect(importer.POST(request('POST', { tables: exportResponse.tables }, { headers: { 'cf-access-authenticated-user-email': owner } })));
  assert.deepEqual(copy.sqlite.prepare('SELECT * FROM manual_tasks ORDER BY id').all(), copyRows);

  // Import a task linked to a newly generated student ID, preserving audit profiles.
  const additive = exportResponse.tables.map(table => ({ ...table, rows: [] }));
  const studentTable = additive.find(table => table.name === 'students');
  studentTable.rows.push({ id: 'new:student', first_name: 'New', last_name: 'Student', email: '', phone: '', picture: null, active: 1, birth_date: null, facebook_url: '', instagram_url: '' });
  const manualTable = additive.find(table => table.name === 'manual_tasks');
  manualTable.rows.push({ ...copyRows[0], id: 'new:task', request_key: 'imported-task-new-student', created_by: 'historical@example.test', updated_by: 'historical@example.test' });
  additive.find(table => table.name === 'task_students').rows.push({task_id: 'new:task', student_id: 'new:student'});
  await expect(importer.POST(request('POST', { tables: additive }, { headers: { 'cf-access-authenticated-user-email': owner } })));
  const imported = copy.sqlite.prepare("SELECT student_id FROM task_students JOIN manual_tasks ON manual_tasks.id=task_students.task_id WHERE request_key='imported-task-new-student'").get();
  assert.equal(copy.sqlite.prepare('SELECT first_name FROM students WHERE id=?').get(imported.student_id).first_name, 'New');
  assert.deepEqual(copy.sqlite.prepare('PRAGMA foreign_key_check').all(), []);

  globalThis.taskTestEnv.STUDENT_IMAGES = { async delete() {} };
  await expect(clear.POST(request('POST', {})));
  assert.equal(copy.sqlite.prepare('SELECT COUNT(*) n FROM manual_tasks').get().n, 0);
  assert.equal(copy.sqlite.prepare('SELECT COUNT(*) n FROM students').get().n, 0);
  assert.ok(copy.sqlite.prepare('SELECT revision FROM task_board_state WHERE id=1').get());
  copy.sqlite.close();
  globalThis.taskTestEnv.DB = db;

  const count = rows().length;
  await expect(item.DELETE(request('DELETE', { revision: revision() }), context(second.task.key)));
  assert.equal(rows().length, count - 1);
  await expect(item.DELETE(request('DELETE', { revision: revision() }), context(second.task.key)), 404);
  assert.equal(domain.schoolToday(new Date('2026-12-31T22:30:00Z')), '2027-01-01');
  assert.equal(domain.manualTaskFields({ title: 'Leap day', dueDate: '2028-02-29' }).dueDate, '2028-02-29');
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS: task CRUD, validation, permissions, retries, ordering, concurrent rollback, student deletion protection, copies, imports and clear-data.');
} finally {
  db.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
  delete globalThis.taskTestEnv;
}
