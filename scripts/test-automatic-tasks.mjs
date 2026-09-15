import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const RealDate = Date;
let instant = '2026-12-01T10:00:00Z';
globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return new RealDate(instant).getTime(); } };
const directory = mkdtempSync(join(tmpdir(), 'fsd-automatic-tasks-'));
const databases = [];
function database() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
  for (const file of readdirSync('migrations').filter(file => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  const db = { sqlite, queries: 0, fail: false, before: null, prepare(sql) {
    let values = [];
    const statement = { sql, bind(...args) { values = args; return statement; }, execute() {
      db.queries++;
      if (db.fail && sql.startsWith('INSERT INTO automatic_task_occurrences')) throw new Error('Injected occurrence failure');
      const query = sqlite.prepare(sql), results = query.columns().length ? query.all(...values) : (query.run(...values), []);
      return { results, meta: { changes: Number(sqlite.prepare('SELECT changes() n').get().n) } };
    }, async all() { return statement.execute(); }, async first() { return statement.execute().results[0] ?? null; }, async run() { return statement.execute(); } };
    return statement;
  }, async batch(statements) {
    if (db.before && statements.some(statement => statement.sql === 'UPDATE task_board_state SET revision = ? WHERE id = 1')) { const callback = db.before; db.before = null; callback(); }
    sqlite.exec('BEGIN'); try { const result = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } }; return db;
}
const db = database(), deletedImages = [];
globalThis.automaticTestEnv = { DB: db, STUDENT_IMAGES: { async delete(key) { deletedImages.push(key); } } };
async function load(file, tag, extraRule = false) {
  const outfile = join(directory, `${tag}.mjs`);
  await build({ entryPoints: [file], outfile, bundle: true, format: 'esm', platform: 'node', plugins: [{ name: 'fixture', setup(context) {
    context.onLoad({ filter: /app\/lib\/storage\.ts$/ }, () => ({ contents: 'export const env = globalThis.automaticTestEnv;', loader: 'ts' }));
    if (extraRule) context.onLoad({ filter: /app\/lib\/task-rules\.ts$/ }, args => ({ contents: readFileSync(args.path, 'utf8') + `\ntaskRules.push({ key: 'synthetic', title: 'Synthetic category', retention: 'state', evaluate: ({students}) => students.filter(s=>s.id===2).map(s=>({ruleKey:'synthetic',subjectKey:'student:'+s.id,occurrenceKey:'condition-1',studentId:s.id,title:'Calculated test condition',description:'',dueDate:null})) });`, loader: 'ts' }));
  } }] });
  return import(pathToFileURL(outfile));
}
const owner = 'croitoriu.alexandru.code@gmail.com', origin = 'https://school.test';
const request = (method = 'GET', body, overrides = {}) => new Request(`${origin}/api/tasks`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'cf-access-authenticated-user-email': owner, ...overrides }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const context = key => ({ params: Promise.resolve({ key }) });
const revision = () => db.sqlite.prepare('SELECT revision FROM task_board_state WHERE id=1').get().revision;
const occurrences = () => db.sqlite.prepare('SELECT * FROM automatic_task_occurrences ORDER BY id').all();
const at = date => { instant = `${date}T10:00:00Z`; };
const seed = (id, birthDate, active = 1) => db.sqlite.prepare("INSERT INTO students(id,first_name,last_name,email,birth_date,active) VALUES (?,?,'Student','',?,?)").run(id, `Test ${id}`, birthDate, active);
async function expect(promise, status = 200) { const response = await promise; const body = response.status === 204 ? null : await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; }
try {
  const dates = await load('app/lib/task-dates.ts', 'dates');
  const rules = await load('app/lib/task-rules.ts', 'rules');
  const domain = await load('app/lib/tasks.ts', 'domain');
  const api = await load('app/api/tasks/route.ts', 'tasks');
  const item = await load('app/api/tasks/[key]/route.ts', 'item');
  const refresh = await load('app/api/tasks/refresh/route.ts', 'refresh');
  const moves = await load('app/api/tasks/move/route.ts', 'move');
  const studentApi = await load('app/api/students/[id]/route.ts', 'student');
  const studentCreate = await load('app/api/students/route.ts', 'create-student');
  const exporter = await load('app/api/administrators/export/route.ts', 'export');
  const importer = await load('app/api/administrators/import/route.ts', 'import');
  const transfer = await load('app/lib/local-database-transfer.ts', 'transfer');
  const clear = await load('app/api/administrators/clear-data/route.ts', 'clear');
  const sync = () => expect(refresh.POST(request('POST', {})));
  const patch = (key, values) => expect(item.PATCH(request('PATCH', { revision: revision(), ...values }), context(key)));
  const studentPatch = async (id, values) => {
    const current = await expect(studentApi.GET(request(), { params: Promise.resolve({ id: String(id) }) }));
    return expect(studentApi.PATCH(request('PATCH', { ...current, ...values }), { params: Promise.resolve({ id: String(id) }) }));
  };
  assert.equal(dates.nextBirthday('1990-01-05', '2026-12-20'), '2027-01-05');
  assert.equal(dates.nextBirthday('2000-02-29', '2027-02-28'), '2027-03-01');
  assert.equal(dates.nextBirthday('2000-02-29', '2028-02-28'), '2028-02-29');
  assert.equal(dates.nextBirthday('2000-02-29', '2028-03-01'), '2029-03-01');
  assert.equal(dates.nextBirthday('1990-01-05', '2027-01-05'), '2027-01-05');
  assert.equal(dates.nextBirthday('1990-02-30', '2027-01-05'), null);
  assert.equal(dates.nextBirthday('2030-01-01', '2027-01-05'), null);
  assert.equal(domain.schoolToday(new RealDate('2026-12-31T22:15:00Z')), '2027-01-01');
  assert.equal(domain.schoolToday(new RealDate('2027-06-01T21:15:00Z')), '2027-06-02');
  const birthdays = rules.taskRules[0];
  const candidateStudents = [{ id: 1, firstName: 'Boundary', lastName: 'Test', active: 1, birthDate: '2000-01-05' }];
  assert.equal(birthdays.evaluate({ today: '2026-12-05', from: '2026-12-05', students: candidateStudents }).length, 0);
  assert.equal(birthdays.evaluate({ today: '2026-12-06', from: '2026-12-06', students: candidateStudents }).length, 1);

  seed(1, '1990-01-05'); seed(2, '1990-12-20'); seed(3, '2000-02-29'); seed(4, '1990-01-10', 0); seed(5, '1990-02-15'); seed(6, null); seed(8, '1990-04-01');
  const beforeRead = revision();
  assert.deepEqual((await expect(api.GET(request()))).tasks, []);
  assert.equal(revision(), beforeRead); assert.equal(occurrences().length, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM task_rule_state').get().n, 0);
  await expect(refresh.POST(request('POST', {}, { 'cf-access-authenticated-user-email': 'denied@example.test' })), 403);
  await expect(refresh.POST(request('POST', {}, { Origin: 'https://other.test' })), 403);
  db.fail = true;
  await expect(refresh.POST(request('POST', {})), 500);
  assert.equal(revision(), beforeRead); assert.equal(occurrences().length, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM task_rule_state').get().n, 0);
  db.fail = false;
  let board = await sync();
  assert.equal(board.tasks.length, 1); assert.equal(board.tasks[0].dueDate, '2026-12-20');
  assert.equal(board.tasks[0].source, 'automatic'); assert.equal(board.tasks[0].canEditContent, false);
  assert.ok(board.views.some(view => view.key === 'birthday'));
  const december = board.tasks[0].key, afterFirst = revision();
  await sync(); assert.equal(revision(), afterFirst, 'Same-day refresh is idempotent.');
  at('2026-12-06'); board = await sync();
  const january = board.tasks.find(task => task.student?.id === 1);
  assert.equal(january.dueDate, '2027-01-05'); assert.ok(january.key.endsWith(':2027'));
  await patch(january.key, { status: 'done' });
  await expect(item.PATCH(request('PATCH', { revision: revision(), title: 'Rewrite automatic content' }), context(january.key)), 400);
  await expect(item.PATCH(request('PATCH', { revision: revision(), studentId: 2 }), context(january.key)), 400);
  await expect(item.DELETE(request('DELETE', { revision: revision() }), context(january.key)), 400);
  await sync(); assert.equal(occurrences().length, 2);
  at('2027-01-10'); board = await sync();
  assert.equal(board.tasks.find(task => task.key === december).status, 'todo');
  assert.equal(board.tasks.find(task => task.key === december).dueDate, '2026-12-20');
  await studentPatch(2, { birthDate: '1990-12-25' });
  assert.equal((await expect(item.GET(request(), context(december)))).task.dueDate, '2026-12-25');
  await patch(december, { dismissed: true }); await studentPatch(2, { birthDate: '1990-12-27' });
  assert.equal((await expect(item.GET(request(), context(december)))).task.dueDate, '2026-12-25');
  await studentPatch(1, { birthDate: '1990-01-07' });
  assert.equal((await expect(item.GET(request(), context(january.key)))).task.dueDate, '2027-01-05');
  at('2027-01-30'); board = await sync();
  const leap = board.tasks.find(task => task.student?.id === 3), recurring = board.tasks.find(task => task.student?.id === 5);
  assert.equal(leap.dueDate, '2027-03-01');
  await patch(recurring.key, { status: 'done' }); await studentPatch(3, { active: false });
  assert.ok(occurrences().some(row => row.student_id === 3), 'Inactivation keeps retained occurrences.');
  const beforeDelete = revision();
  await expect(studentApi.DELETE(request('DELETE'), { params: Promise.resolve({ id: '1' }) }), 409);
  assert.equal(revision(), beforeDelete, 'Blocked deletion rolls back reconciliation.');
  await patch(january.key, { studentId: null }); await sync();
  assert.equal((await expect(item.GET(request(), context(january.key)))).task.student, null);
  await expect(studentApi.DELETE(request('DELETE'), { params: Promise.resolve({ id: '1' }) }), 204);
  at('2028-01-16'); board = await sync();
  assert.equal(board.tasks.filter(task => task.student?.id === 5).length, 2);
  assert.equal(board.tasks.find(task => task.key === recurring.key).status, 'done');
  assert.equal(board.tasks.find(task => task.student?.id === 5 && task.key !== recurring.key).dueDate, '2028-02-15');
  assert.equal(board.tasks.filter(task => task.student?.id === 3).length, 1);
  assert.equal(board.tasks.find(task => task.key === january.key).student, null, 'Deleted/unlinked identity never recreates a relationship.');
  at('2028-02-01'); await studentPatch(3, { active: true }); board = await expect(api.GET(request()));
  assert.ok(board.tasks.some(task => task.student?.id === 3 && task.dueDate === '2028-02-29'));
  at('2028-03-10'); await studentPatch(6, { birthDate: '1990-02-01' });
  assert.equal(occurrences().filter(row => row.student_id === 6).length, 0, 'A newly entered past birthday creates no historical backlog.');
  const created = await expect(studentCreate.POST(request('POST', { firstName: 'Created', lastName: 'Now', email: '', phone: '', birthDate: '1990-03-15', facebookUrl: '', instagramUrl: '', picture: null, active: true, courseIds: [] })), 201);
  assert.ok(occurrences().some(row => row.student_id === created.id && row.due_date === '2028-03-15'));
  // Nobody opened Tasks before this inactivation: prior eligibility must survive.
  at('2028-05-01'); await studentPatch(8, { active: false });
  assert.ok(occurrences().some(row => row.student_id === 8 && row.due_date === '2028-04-01'));
  await studentPatch(8, { birthDate: null });
  assert.ok(occurrences().some(row => row.student_id === 8 && row.due_date === '2028-04-01'));

  const studentBeforeFailure = await expect(studentApi.GET(request(), { params: Promise.resolve({ id: '6' }) }));
  const revisionBeforeFailure = revision();
  db.fail = true;
  await expect(studentApi.PATCH(request('PATCH', { ...studentBeforeFailure, birthDate: '1990-05-10' }), { params: Promise.resolve({ id: '6' }) }), 500);
  db.fail = false;
  assert.equal(revision(), revisionBeforeFailure);
  assert.equal((await expect(studentApi.GET(request(), { params: Promise.resolve({ id: '6' }) }))).birthDate, studentBeforeFailure.birthDate, 'Student changes roll back when automatic occurrence writes fail.');

  const manual = await expect(api.POST(request('POST', { title: 'Mixed task', revision: revision(), requestKey: 'automatic-test-manual-creation' })), 201);
  await expect(moves.POST(request('POST', { key: manual.task.key, status: 'todo', position: 'before', targetKey: december, revision: revision() })));
  const mixed = await expect(moves.POST(request('POST', { key: december, status: 'todo', position: 'before', targetKey: manual.task.key, revision: revision() })));
  assert.ok(mixed.tasks.findIndex(task => task.key === december) < mixed.tasks.findIndex(task => task.key === manual.task.key));
  assert.equal(mixed.tasks.find(task => task.key === december).dismissed, true);
  await patch(december, { dismissed: false });
  const beforeRefreshOrder = (await expect(api.GET(request()))).tasks.map(task => [task.key, task.status, task.sortOrder]);
  await sync(); assert.deepEqual((await expect(api.GET(request()))).tasks.map(task => [task.key, task.status, task.sortOrder]), beforeRefreshOrder);

  // Concurrent refresh retries from a fresh student snapshot, avoiding stale birthdays.
  seed(20, '1990-05-05');
  db.before = () => db.sqlite.prepare("UPDATE students SET birth_date='1990-06-10' WHERE id=20").run();
  await sync(); assert.equal(occurrences().filter(row => row.student_id === 20).length, 0);
  const progressBeforeFailure = db.sqlite.prepare('SELECT * FROM task_rule_state').all();
  at('2028-06-01'); db.fail = true; await expect(refresh.POST(request('POST', {})), 500); db.fail = false;
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM task_rule_state').all(), progressBeforeFailure);
  await sync(); assert.ok(occurrences().some(row => row.student_id === 20 && row.due_date === '2028-06-10'));
  assert.equal(occurrences().length, new Set(occurrences().map(row => `${row.rule_key}/${row.subject_key}/${row.occurrence_key}`)).size);

  // A second, test-only transient rule appears on GET without a row. Acting on
  // it materializes only occurrence state; no Kanban/API specialization is added.
  db.sqlite.prepare("INSERT INTO task_rule_state VALUES ('synthetic','2028-06-01','2028-06-01')").run();
  const virtualApi = await load('app/api/tasks/route.ts', 'virtual-tasks', true), virtualItem = await load('app/api/tasks/[key]/route.ts', 'virtual-item', true);
  const storedCount = occurrences().length, virtualRevision = revision();
  const virtual = (await expect(virtualApi.GET(request()))).tasks.find(task => task.category === 'synthetic');
  assert.ok(virtual); assert.equal(virtual.source, 'automatic'); assert.equal(occurrences().length, storedCount); assert.equal(revision(), virtualRevision);
  await expect(virtualItem.PATCH(request('PATCH', { status: 'done', revision: revision() }), context(virtual.key)));
  assert.equal(occurrences().length, storedCount + 1);
  assert.equal((await expect(virtualApi.GET(request()))).tasks.filter(task => task.key === virtual.key).length, 1);
  assert.equal((await expect(virtualApi.GET(request()))).tasks.find(task => task.key === virtual.key).status, 'done');

  const exported = await expect(exporter.GET(request()));
  const copy = database(); await transfer.replaceDatabase(copy, exported.tables, null);
  assert.deepEqual(copy.sqlite.prepare('SELECT * FROM automatic_task_occurrences ORDER BY id').all(), occurrences());
  assert.deepEqual(copy.sqlite.prepare('SELECT * FROM task_rule_state ORDER BY rule_key').all(), db.sqlite.prepare('SELECT * FROM task_rule_state ORDER BY rule_key').all());
  const originalState = db.sqlite.prepare('SELECT * FROM task_rule_state ORDER BY rule_key').all();
  const additive = exported.tables.map(table => ({ ...table, rows: [] }));
  additive.find(table => table.name === 'students').rows.push({ ...exported.tables.find(table => table.name === 'students').rows[0], id: 'new:linked', first_name: 'Imported', birth_date: '1990-07-01' });
  const sample = occurrences().find(row => row.rule_key === 'birthday');
  additive.find(table => table.name === 'automatic_task_occurrences').rows.push({ ...sample, id: 'new:occurrence', subject_key: 'student:new:linked', student_id: 'new:linked', status: 'done', occurrence_key: '2028', due_date: '2028-07-01', unlinked: 0 });
  await expect(importer.POST(request('POST', { tables: additive })));
  const imported = db.sqlite.prepare("SELECT a.* FROM automatic_task_occurrences a JOIN students s ON s.id=a.student_id WHERE s.first_name='Imported'").get();
  assert.equal(imported.subject_key, `student:${imported.student_id}`); assert.equal(imported.status, 'done');
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM task_rule_state ORDER BY rule_key').all(), originalState, 'Additive imports preserve destination rule activation/progress.');
  await expect(importer.POST(request('POST', { tables: exported.tables.filter(table => !['automatic_task_occurrences', 'task_rule_state'].includes(table.name)) })));
  const malformed = exported.tables.map(table => ({ ...table, rows: table.name === 'automatic_task_occurrences' ? [{ ...sample, id: null, student_id: 2, subject_key: 'student:3' }] : [] }));
  const beforeMalformed = occurrences().length;
  await expect(importer.POST(request('POST', { tables: malformed })), 400);
  assert.equal(occurrences().length, beforeMalformed, 'Mismatched imported identity cannot create a duplicate student/year.');
  await expect(clear.POST(request('POST', {})));
  assert.equal(occurrences().length, 0); assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM task_rule_state').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM students').get().n, 0);
  // More than one JSON chunk: catch-up and ordering stay below D1's query
  // limit without truncating occurrences or introducing equal saved positions.
  for (let id = 1000; id < 1600; id++) seed(id, '1990-06-10');
  db.queries = 0;
  const large = await sync();
  assert.equal(large.tasks.length, 600);
  assert.ok(db.queries < 30);
  assert.equal(new Set(large.tasks.map(task => task.sortOrder)).size, 600);
  db.queries = 0;
  const movedLarge = await expect(moves.POST(request('POST', { key: large.tasks.at(-1).key, status: 'todo', position: 'top', revision: revision() })));
  assert.equal(movedLarge.tasks[0].key, large.tasks.at(-1).key);
  assert.equal(new Set(movedLarge.tasks.map(task => task.sortOrder)).size, 600);
  assert.ok(db.queries < 30);
  console.log('PASS: automatic occurrence engine, birthdays, dates/timezone, yearly recurrence, overdue catch-up, student lifecycle, mixed ordering, sparse state, rollback/concurrency, copies, imports, and clear-data.');
} finally { globalThis.Date = RealDate; for (const sqlite of databases) sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
