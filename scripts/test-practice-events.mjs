import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for (const migration of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
function prepare(sql) {
  let values = [];
  const statement = {
    bind(...next) { values = next; return statement; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return statement.execute(); },
    execute() { const query = sqlite.prepare(sql), results = query.columns().length ? query.all(...values) : (query.run(...values), []); return { results, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }; },
  };
  return statement;
}
const db = { prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map((statement) => statement.execute()); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
globalThis.practiceEnv = { DB: db };
const directory = resolve('.wrangler/practice-test'); mkdirSync(directory, { recursive: true });
async function load(file, name) {
  const outfile = resolve(directory, `${name}.mjs`);
  await build({ entryPoints: [file], outfile, bundle: true, format: 'esm', platform: 'node', plugins: [{ name: 'test-bindings', setup(buildContext) { buildContext.onLoad({ filter: /app\/lib\/storage\.ts$/ }, () => ({ contents: 'export const env = globalThis.practiceEnv;', loader: 'ts' })); } }] });
  return import(pathToFileURL(outfile).href);
}

try {
  const parties = await load('app/api/practice-parties/route.ts', 'parties');
  const party = await load('app/api/practice-parties/[id]/route.ts', 'party');
  const roster = await load('app/api/practice-parties/[id]/roster/route.ts', 'roster');
  const activity = await load('app/api/students/[id]/activity/route.ts', 'activity');
  const payments = await load('app/api/students/payments/route.ts', 'payments');
  sqlite.exec("INSERT INTO students (first_name,last_name,email,phone) VALUES ('Ana','Student','ana@test','0700000001'),('Ben','Student','ben@test','0700000002'); INSERT INTO admin_profiles(email,name) VALUES ('admin@test','Admin');");
  let requestNumber = 0;
  const request = (body, method = 'POST', path = '/api/practice-parties/1') => new Request(`https://school.test${path}`, { method, headers: { 'Content-Type': 'application/json', 'cf-access-authenticated-user-email': 'admin@test' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const context = (id = 1) => ({ params: Promise.resolve({ id: String(id) }) });
  const keyed = (body) => ({ ...body, requestKey: `practice-test-key-${++requestNumber}` });
  const expect = async (response, status) => { const result = await response, body = await result.json(); assert.equal(result.status, status, JSON.stringify(body)); return body; };
  const revision = () => sqlite.prepare('SELECT revision FROM practice_parties WHERE id = 1').get().revision;

  const creation = keyed({ action: 'create', session: { date: '2026-01-07', time: '20:00', durationMinutes: 120 } });
  await expect(parties.POST(request(creation, 'POST', '/api/practice-parties')), 201);
  await expect(parties.POST(request(creation, 'POST', '/api/practice-parties')), 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM practice_parties').get().count, 1);
  const phoneSearch = await expect(roster.GET(request(null, 'GET', '/api/practice-parties/1/roster?q=0700000002'), context()), 200);
  assert.equal(phoneSearch.count, 1); assert.equal(phoneSearch.students[0].firstName, 'Ben');

  const attendance = keyed({ action: 'attendance_batch', revision: revision(), addStudentIds: [1], removeAttendanceIds: [], donations: [{ studentId: 1, amount: '30.50', paidOn: '2026-01-07', notes: 'Thank you' }] });
  await expect(party.POST(request(attendance), context()), 201);
  await expect(party.POST(request(attendance), context()), 200);
  const recorded = sqlite.prepare('SELECT * FROM practice_attendance').get();
  assert.equal(recorded.student_id, 1); assert.equal(recorded.donation_amount_minor, 3050); assert.equal(recorded.donation_paid_on, '2026-01-07');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ('practice_requests', 'practice_changes', 'practice_donations')").get().count, 0);

  const detail = await expect(party.GET(request(null, 'GET'), context()), 200);
  assert.deepEqual(detail.totals, { receivedMinor: 3050, givenMinor: 0, pendingMinor: 3050 });
  assert.equal(detail.payments[0].id, recorded.id);
  const studentActivity = await expect(activity.GET(request(null, 'GET', '/api/students/1/activity'), context(1)), 200);
  assert.equal(studentActivity.logs.filter((row) => row.kind === 'practice_attendance').length, 1);
  assert.equal(studentActivity.logs.find((row) => row.kind === 'practice_attendance').amountMinor, 3050);
  assert.equal(studentActivity.summary.donationsMinor, 3050);

  let report = await expect(payments.GET(request(null, 'GET', '/api/students/payments')), 200);
  assert.equal(report.count, 1); assert.equal(report.payments[0].purpose, 'practice_donation');
  await expect(payments.PATCH(request({ paymentId: recorded.id, studentId: 1, practiceId: 1, purpose: 'practice_donation', givenToSchool: true }, 'PATCH', '/api/students/payments')), 200);
  assert.equal(sqlite.prepare('SELECT donation_given_to_school FROM practice_attendance WHERE id = ?').get(recorded.id).donation_given_to_school, 1);
  report = await expect(payments.GET(request(null, 'GET', '/api/students/payments?status=given')), 200);
  assert.equal(report.totals.givenMinor, 3050);

  const removal = keyed({ action: 'attendance_batch', revision: revision(), addStudentIds: [], removeAttendanceIds: [recorded.id], donations: [] });
  await expect(party.POST(request(removal), context()), 201);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM practice_attendance').get().count, 0);
  assert.equal((await expect(payments.GET(request(null, 'GET', '/api/students/payments')), 200)).count, 0);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS: practice parties keep one attendance per student, optional donation fields, retry protection, student activity, and dashboard transfer handling.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
