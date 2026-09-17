import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
let beforeBatch;
function prepare(sql) {
  let args = [];
  return {
    bind(...values) { args = values; return this; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { return this.execute(); },
    execute() { const query = sqlite.prepare(sql); const results = query.columns().length ? query.all(...args) : (query.run(...args), []); return { results, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } }; },
  };
}
globalThis.freeMeetingTestEnv = { DB: { prepare, async batch(statements) {
  beforeBatch?.(); beforeBatch = undefined;
  sqlite.exec('BEGIN');
  try { const result = statements.map(item => item.execute()); sqlite.exec('COMMIT'); return result; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} } };
async function load(file) {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'test-storage', setup(context) {
    context.onLoad({ filter: /app\/lib\/storage\.ts$/ }, () => ({ contents: 'export const env = globalThis.freeMeetingTestEnv;', loader: 'ts' }));
  } }] });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
try {
  const api = await load('app/api/free-events/[id]/meetings/[meetingId]/roster/route.ts');
  const history = await load('app/api/free-events/[id]/meetings/[meetingId]/history/route.ts');
  const meetingApi = await load('app/api/free-events/[id]/meetings/[meetingId]/route.ts');
  sqlite.exec(`
    INSERT INTO admin_profiles (email,name,picture) VALUES ('admin@test','Test Admin','/api/administrator-images/test.jpg');
    INSERT INTO students (first_name,last_name,email,phone) VALUES ('Ana','Student','ana@test','0700000001'),('Ben','Student','ben@test','0700000002');
    INSERT INTO free_events (id,name,created_by,created_at,updated_at) VALUES (1,'Event','admin@test','now','now'),(2,'Other','admin@test','now','now');
    INSERT INTO free_event_meetings (id,event_id,name,starts_at,starts_utc,duration_minutes,space_rent_minor,accepts_donations,created_by,created_at,updated_at) VALUES (1,1,'Meeting','2026-09-19T20:00','2026-09-19T17:00:00Z',120,0,1,'admin@test','now','now'),(2,2,'Other','2026-09-19T20:00','2026-09-19T17:00:00Z',120,0,0,'admin@test','now','now');
  `);
  const context = (id = 1, meetingId = 1) => ({ params: Promise.resolve({ id: String(id), meetingId: String(meetingId) }) });
  const request = (body, query = '', headers = {}) => new Request(`https://school.test/api/free-events/1/meetings/1/roster${query}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'cf-access-authenticated-user-email': 'admin@test', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const expect = async (response, status = 200) => { const result = await response, data = await result.json(); assert.equal(result.status, status, JSON.stringify(data)); return data; };
  const revision = () => sqlite.prepare('SELECT revision FROM free_event_meetings WHERE id=1').get().revision;
  let key = 0;
  const body = patch => ({ action: 'attendance_batch', revision: revision(), requestKey: `free-meeting-test-${++key}`, addStudentIds: [], removeAttendanceIds: [], donations: [], ...patch });
  const add = body({ addStudentIds: [1], donations: [{ studentId: 1, amount: '25,50', receivedMethod: 'Cash' }] });
  await expect(api.POST(request(add), context()));
  await expect(api.POST(request(add), context()));
  assert.equal(revision(), 1, 'Retry does not duplicate revision/history');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM free_event_attendance').get().n, 1);
  assert.equal(sqlite.prepare('SELECT donation_amount_minor FROM free_event_attendance').get().donation_amount_minor, 2550);
  assert.equal(sqlite.prepare("SELECT amount_minor FROM report_payment_records WHERE purpose='free_event_donation'").get().amount_minor, 2550);
  const roster = await expect(api.GET(request(null), context()));
  assert.equal(roster.students[0].firstName, 'Ana'); assert.ok(roster.students[0].attendanceId);
  assert.equal((await expect(api.GET(request(null, '?q=0700000002'), context()))).students[0].firstName, 'Ben');
  await expect(api.GET(request(null), context(2, 1)), 404);
  await expect(api.GET(request(null, '?page=0'), context()), 400);
  await expect(api.GET(request(null, '', { 'cf-access-authenticated-user-email': '' }), context()), 401);
  await expect(api.POST(request(body({ addStudentIds: [2] }), '', { Origin: 'https://other.test' }), context()), 403);
  await expect(api.POST(request(body({ addStudentIds: [2], revision: 0 })), context()), 409);
  await expect(api.POST(request(body({ donations: [{ studentId: 2, amount: '5', receivedMethod: 'Cash' }] })), context()), 400);
  await expect(api.POST(request(body({ donations: [{ studentId: 1, amount: '-5', receivedMethod: 'Cash' }] })), context()), 400);
  await expect(api.POST(request(body({ donations: [{ studentId: 1, amount: '5', receivedMethod: 'Unknown' }] })), context()), 400);
  await expect(api.POST(request(body({ addStudentIds: [2, 2] })), context()), 400);
  const logs = await expect(history.GET(request(null), context()));
  assert.equal(logs.length, 1); assert.equal(logs[0].administrator, 'Test Admin'); assert.equal(logs[0].administratorPicture, '/api/administrator-images/test.jpg');
  assert.match(JSON.parse(logs[0].beforeJson).attendance, /Ana Student: Not attending/);
  assert.match(JSON.parse(logs[0].afterJson).attendance, /Ana Student: Attended/);
  const update = { action: 'update', revision: revision(), meeting: { name: 'Renamed', date: '2026-09-20', time: '21:00', durationMinutes: 90, spaceRent: '10', acceptsDonations: true } };
  await expect(meetingApi.POST(request(update), context()));
  const detailLog = (await expect(history.GET(request(null), context())))[0];
  assert.equal(JSON.parse(detailLog.beforeJson).startsAt, '2026-09-19T20:00');
  assert.equal(JSON.parse(detailLog.beforeJson).durationMinutes, 120);
  assert.equal(JSON.parse(detailLog.afterJson).spaceRentMinor, 1000);
  sqlite.exec('UPDATE free_event_meetings SET accepts_donations=0 WHERE id=1');
  await expect(api.POST(request(body({ donations: [{ studentId: 1, amount: '5', receivedMethod: 'Cash' }] })), context()), 400);
  await expect(api.POST(request(body({ addStudentIds: [2] })), context()));
  sqlite.exec('UPDATE free_event_meetings SET accepts_donations=1 WHERE id=1');
  const before = revision(), logCount = sqlite.prepare('SELECT COUNT(*) AS n FROM free_meeting_change_log').get().n;
  beforeBatch = () => sqlite.exec('UPDATE free_event_meetings SET revision=revision+1 WHERE id=1');
  await expect(api.POST(request(body({ donations: [{ studentId: 1, amount: '99', receivedMethod: 'Cash' }] })), context()), 409);
  assert.equal(revision(), before + 1); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM free_meeting_change_log').get().n, logCount);
  assert.equal(sqlite.prepare('SELECT donation_amount_minor FROM free_event_attendance WHERE student_id=1').get().donation_amount_minor, 2550, 'Concurrent stale request cannot write donations');
  const attendanceId = sqlite.prepare('SELECT id FROM free_event_attendance WHERE student_id=1').get().id;
  sqlite.exec('UPDATE free_event_attendance SET donation_given_to_school=1 WHERE student_id=1');
  await expect(api.POST(request(body({ removeAttendanceIds: [attendanceId] })), context()), 409);
  sqlite.exec('UPDATE free_event_attendance SET donation_given_to_school=0 WHERE student_id=1');
  beforeBatch = () => sqlite.exec('UPDATE free_event_attendance SET donation_given_to_school=1 WHERE student_id=1');
  await expect(api.POST(request(body({ removeAttendanceIds: [attendanceId] })), context()), 409);
  assert.ok(sqlite.prepare('SELECT id FROM free_event_attendance WHERE id=?').get(attendanceId));
  sqlite.exec('UPDATE free_event_attendance SET donation_given_to_school=0 WHERE student_id=1');
  await expect(api.POST(request(body({ donations: [{ studentId: 1, amount: '', receivedMethod: '' }] })), context()));
  assert.equal(sqlite.prepare('SELECT donation_amount_minor FROM free_event_attendance WHERE student_id=1').get().donation_amount_minor, null);
  await expect(api.POST(request(body({ removeAttendanceIds: [attendanceId] })), context()));
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM free_event_attendance').get().n, 1);
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  console.log('PASS: meeting attendance, optional donations, reports, history, administrator identities, validation, idempotency, and concurrent-save/transfer protection.');
} finally { sqlite.close(); delete globalThis.freeMeetingTestEnv; }
