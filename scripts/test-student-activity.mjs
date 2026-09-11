import assert from "node:assert/strict";
import { mock } from "node:test";
mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-10T12:00:00Z") });
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { stripTypeScriptTypes } from "node:module";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const name of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync("migrations/" + name, "utf8"));
function prepare(sql) {
  let values = [];
  const statement = {
    bind(...args) { values = args; return statement; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async run() { return statement.execute(); },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    execute() {
      const query = sqlite.prepare(sql);
      const results = query.columns().length ? query.all(...values) : (query.run(...values), []);
      return { results, meta: { changes: sqlite.prepare("SELECT changes() AS n").get().n } };
    },
  };
  return statement;
}
const db = {
  prepare,
  async batch(statements) {
    sqlite.exec("BEGIN");
    try { const result = statements.map((statement) => statement.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
globalThis.activityTestEnv = { DB: db };
function moduleUrl(source) {
  const js = stripTypeScriptTypes(source);
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const helperUrl = moduleUrl(readFileSync("app/lib/student-activity.ts", "utf8"));
const helpers = await import(helperUrl);
const api = await import(moduleUrl(readFileSync("app/api/students/[id]/activity/route.ts", "utf8")
  .replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.activityTestEnv;')
  .replace('"../../../../lib/student-activity"', JSON.stringify(helperUrl))));
const classHelper = moduleUrl(readFileSync('app/lib/class-attendance.ts','utf8'));
const classApi = await import(moduleUrl(readFileSync('app/api/class-attendance/route.ts','utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.activityTestEnv;').replace('"../../lib/class-attendance"',JSON.stringify(classHelper)).replace('"../../lib/student-activity"',JSON.stringify(helperUrl))));
const recordClass = (body) => classApi.POST(request({courseId:body.courseId,classDate:body.classDate,startTime:'18:30',studentIds:[1]}, 'croitoriu.alexandru.code@gmail.com'));
const context = (id=1) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (body, email='admin@example.test', url='https://example.test/api/students/1/activity') => new Request(url, { method:'POST', headers: { 'Content-Type':'application/json', ...(email ? {'cf-access-authenticated-user-email':email} : {}) }, body:JSON.stringify(body) });
const read = async (id=1, suffix='') => { const response = await api.GET(new Request('https://example.test/api/students/'+id+'/activity'+suffix),context(id)); assert.equal(response.status,200); return response.json(); };
sqlite.exec("INSERT INTO students (first_name,last_name,email) VALUES ('A','Test','a@example.test'),('B','Test','b@example.test'); INSERT INTO courses (name) VALUES ('Zouk'),('Basics'); INSERT INTO student_courses VALUES (1,1),(1,2)");
sqlite.exec("INSERT INTO course_schedule (course_id,day_of_week,start_time,end_time) VALUES (1,'Wednesday','18:30','19:30')");
let key=0;
const payment = (extra={}) => ({kind:'payment',requestKey:'test-request-key-'+(++key),notes:'Cash received',paidOn:helpers.schoolToday(),amount:'200,50',allocations:[{courseId:1,allowance:2},{courseId:2,allowance:10}],...extra});
const attendance = (extra={}) => ({kind:'attendance',requestKey:'test-request-key-'+(++key),notes:'',classDate:'2026-09-09',courseId:1,...extra});
assert.equal(helpers.parseAmount('0.01'),1);
assert.equal(helpers.parseAmount('10.10'),1010);
for (const invalid of ['0','-1','1.001','1e3',100,'1000000']) assert.equal(helpers.parseAmount(invalid),null);
assert.equal(helpers.validPastDate('2025-02-29'),false);
assert.equal(helpers.validPastDate('2099-01-01'),false);
assert.equal((await api.POST(request(payment(),null),context())).status,401);
assert.equal((await api.POST(request(payment()),context(999))).status,404);
const first=attendance();
assert.equal((await recordClass(first)).status,200, 'Unpaid attendance must be accepted');
assert.equal((await read()).summary.excessAttendance,1);
assert.equal((await recordClass(first)).status,200,'Retry must not duplicate attendance');
assert.equal((await recordClass(attendance())).status,200,'Same class retry is accepted without another record');
const paid=payment();
assert.equal((await api.POST(request(paid),context())).status,201);
assert.equal((await api.POST(request(paid),context())).status,200,'Retry must not duplicate payment');
assert.equal((await api.POST(request({...paid,amount:'300'}),context())).status,409);
assert.equal((await api.POST(request(paid),context(2))).status,409,'Request keys cannot expose another student record');
for (const allocations of [[],[{courseId:1,allowance:0}],[{courseId:1,allowance:1.5}],[{courseId:1,allowance:1},{courseId:1,allowance:2}]]) assert.equal((await api.POST(request(payment({allocations})),context())).status,400);
assert.equal((await api.POST(request(payment({allocations:[{courseId:1,allowance:3},{courseId:999,allowance:2}]})),context())).status,409);
assert.equal((await read()).summary.paymentCount,1,'Invalid allocation must roll back whole payment');
assert.equal((await read()).summary.totalPaidMinor,20050);
for (const classDate of ['2026-09-02','2026-08-26']) assert.equal((await recordClass(attendance({classDate}))).status,200);
let data=await read();
assert.equal(data.summary.attendanceCount,3);
assert.equal(data.summary.paidAllowance,12);
assert.equal(data.summary.excessAttendance,1,'A surplus in course 2 must not cover debt in course 1');
assert.equal(data.balances.find(b=>b.courseId===1).remainingAllowance,0);
assert.equal(data.payments[0].recordedBy,'admin@example.test');
assert.equal(data.payments[0].allocations.length,2);
assert.equal((await read(2)).summary.attendanceCount,0);
assert.equal((await read(2)).summary.paymentCount,0);
// Later course renames and assignment changes leave historical log labels intact.
sqlite.exec("UPDATE courses SET name='New name' WHERE id=1; DELETE FROM student_courses WHERE student_id=1");
data=await read();
assert.equal(data.attendance[0].courseName,'Zouk');
assert.equal(data.payments[0].allocations[0].courseName,'Zouk');
assert.equal(data.summary.excessAttendance,1);
for(let i=0;i<26;i++) assert.equal((await api.POST(request(payment({amount:'1.00',allocations:[{courseId:2,allowance:1}]})),context())).status,201);
data=await read();
assert.equal(data.payments.length,25);
assert.equal(data.summary.paymentCount,27);
const older=await read(1,'?paymentsPage=2');
assert.equal(older.payments.length,2);
assert.equal(new Set([...data.payments,...older.payments].map(p=>p.id)).size,27);
assert.equal(older.summary.paidAllowance,data.summary.paidAllowance,'Totals must include every page');
assert.throws(()=>sqlite.exec('DELETE FROM students WHERE id=1'),/FOREIGN KEY/);
assert.throws(()=>sqlite.exec('DELETE FROM courses WHERE id=1'),/FOREIGN KEY/);
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS: unpaid attendance, per-course balances, payment allocations, exact money parsing, validation, atomic rollback, retries, log snapshots, pagination and preserved history.');

const workerSource = readFileSync('worker.ts','utf8').replace('import { withStorage } from "./app/lib/storage";', 'const withStorage = (_env, callback) => callback();').replace('import vinextHandler from "vinext/server/fetch-handler";', 'const vinextHandler = { fetch: () => new Response("allowed") };');
const {default:worker} = await import(moduleUrl(workerSource));
const workerEnv = { DB:db, PUBLIC_QR_BASE_URL:'https://go.example.test' };
for (const method of ['GET','POST']) {
  const guarded = (email) => new Request('https://school.example.test/api/students/1/activity', { method, headers:email ? {'cf-access-authenticated-user-email':email} : {} });
  assert.equal((await worker.fetch(guarded(null),workerEnv,{})).status,403);
  sqlite.exec("INSERT OR REPLACE INTO administrator_permissions (email,can_students,can_courses) VALUES ('students@example.test',1,0),('courses@example.test',0,1)");
  assert.equal((await worker.fetch(guarded('students@example.test'),workerEnv,{})).status,200);
  assert.equal((await worker.fetch(guarded('courses@example.test'),workerEnv,{})).status,403);
}
console.log('PASS: Access permission gate protects both reading and writing student activity.');

const firstLogs = await read();
const secondLogs = await read(1,'?logsPage=2');
const thirdLogs = await read(1,'?logsPage=3');
const combinedLogs = [...firstLogs.logs, ...secondLogs.logs, ...thirdLogs.logs];
assert.equal(firstLogs.logs.length,10);
assert.equal(secondLogs.logs.length,10);
assert.equal(thirdLogs.logs.length,10);
assert.equal((await read(1,'?logsPage=4')).logs.length,0);
assert.equal(combinedLogs.length,30);
assert.equal(new Set(combinedLogs.map(row=>row.kind+':'+row.id)).size,30);
assert.equal(combinedLogs.filter(row=>row.kind==='attendance').length,3);
assert.equal(combinedLogs.filter(row=>row.kind==='payment').length,27);
assert.ok(combinedLogs.every((row,i)=>i===0 || combinedLogs[i-1].eventDate>=row.eventDate));
assert.equal((await read(2)).logs.length,0);
assert.ok(combinedLogs.filter(row=>row.kind==='payment').every(row=>row.allocations.length>0));
console.log('PASS: combined chronological logs paginate without omissions or duplicates and remain student-scoped.');

assert.equal((await api.POST(request(attendance()),context())).status,400,'Student-scoped attendance recording is retired');

const coverageLogs = await read();
for (const log of coverageLogs.logs.filter(row => row.kind === 'payment')) {
  for (const allocation of log.allocations) {
    assert.ok(allocation.coverage, 'payment logs include coverage even when other logs are on another page');
    assert.equal(allocation.coverage.classes.length + allocation.coverage.remaining, allocation.allowance);
  }
}
console.log('PASS: paginated payment logs include per-course coverage.');

for (const size of [10,20,30,40,50]) {
  const first = await read(1, `?logsPageSize=${size}`);
  const second = await read(1, `?logsPageSize=${size}&logsPage=2`);
  assert.equal(first.logsPageSize, size);
  assert.equal(first.logs.length, Math.min(size, 30));
  assert.equal(second.logs.length, Math.max(0, Math.min(size, 30-size)));
  assert.equal(new Set([...first.logs,...second.logs].map(row => row.kind+':'+row.id)).size, first.logs.length+second.logs.length);
}
for (const size of ['0','15','60','-10','abc']) {
  assert.equal((await api.GET(new Request(`https://example.test/api/students/1/activity?logsPageSize=${size}`),context())).status,400);
}
console.log('PASS: selectable log page sizes are validated and paginate without duplicate entries.');

const beforeCancellation = await read(1, '?logsPageSize=50');
sqlite.exec("INSERT INTO classes (course_id,class_date,start_time,cancelled) VALUES (1,'2026-09-01','18:30',1)");
const withCancellation = await read(1, '?logsPageSize=50');
const cancelled = withCancellation.logs.filter(row => row.kind === 'cancelled');
assert.equal(cancelled.length, 1);
assert.equal(cancelled[0].eventDate, '2026-09-01T18:30:00');
assert.equal(withCancellation.logsCount, beforeCancellation.logsCount + 1);
assert.deepEqual(withCancellation.summary, beforeCancellation.summary, 'cancellation logs do not alter credits or missed totals');
assert.equal((await read(2)).logs.some(row => row.kind === 'cancelled'), false);
sqlite.exec("UPDATE classes SET cancelled=0 WHERE course_id=1 AND class_date='2026-09-01' AND start_time='18:30'");
assert.equal((await read(1, '?logsPageSize=50')).logs.some(row => row.kind === 'cancelled'), false);
console.log('PASS: cancellation logs are student-scoped, included in pagination totals, and removed on restoration.');

sqlite.exec("INSERT INTO classes (course_id,class_date,start_time,cancelled) VALUES (1,'2099-01-01','18:30',1)");
const upcomingLog = await read(1, '?logsPageSize=50');
assert.ok(upcomingLog.logs.some(row => row.kind === 'cancelled' && row.eventDate === '2099-01-01T18:30:00'), 'known future cancellations are included before attendance reaches them');
assert.equal(upcomingLog.logsCount, upcomingLog.logs.length);
console.log('PASS: API exposes known upcoming cancellations in activity and pagination.');
