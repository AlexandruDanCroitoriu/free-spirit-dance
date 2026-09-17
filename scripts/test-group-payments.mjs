import { moduleUrl } from './lib/test-module-url.mjs';
import assert from "node:assert/strict";
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



const helper=moduleUrl(readFileSync('app/lib/student-activity.ts','utf8'));
const api=await import(moduleUrl(readFileSync('app/api/students/[id]/activity/route.ts','utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/,'const env = globalThis.activityTestEnv;').replace('"../../../../lib/student-activity"',JSON.stringify(helper))));
sqlite.exec("INSERT INTO students (first_name,last_name,email) VALUES ('A','Student','a@test'),('B','Student','b@test'); INSERT INTO courses (name) VALUES ('Zouk'),('Basics')");
const ctx=(id=1)=>({params:Promise.resolve({id:String(id)})});
sqlite.exec("INSERT INTO admin_profiles (email, name) VALUES ('admin@test', ''), ('croitoriu.alexandru.code@gmail.com', '')");
const body={kind:'payment',requestKey:'payment-edit-test-1234',notes:'Original',paidOn:'2026-01-01',amount:'280',receivedMethod:'Cash',allocations:[{courseId:1,allowance:4}]};
const req=(method,data)=>new Request('https://school.test/api/students/1/activity',{method,headers:{'Content-Type':'application/json','cf-access-authenticated-user-email':'admin@test'},body:JSON.stringify(data)});

const group = { ...body, studentCount: 2, studentIds: [1, 2] };
for (const invalid of [
  {studentCount:0}, {studentCount:1.5}, {studentCount:2,studentIds:[1]},
  {studentCount:2,studentIds:[1,1]}, {studentCount:2,studentIds:[2,3]},
  {studentCount:2,studentIds:[1,"2"]}, {studentCount:1,studentIds:[1,2]},
]) assert.equal((await api.POST(req('POST', {...group,...invalid}),ctx())).status,400);
assert.equal((await api.POST(req('POST',{...group,studentIds:[1,999]}),ctx())).status,409);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM student_payments').get().n,0,'Invalid recipient rolls back money');
assert.equal((await api.POST(req('POST',group),ctx())).status,201);
assert.equal((await api.POST(req('POST',{...group,studentIds:[2,1]}),ctx())).status,200,'Retry is order-independent');
assert.equal((await api.POST(req('POST',{...group,studentCount:1,studentIds:[1]}),ctx())).status,409);
const paymentId=sqlite.prepare('SELECT id FROM student_payments').get().id;
const read = async id => (await api.GET(new Request('https://school.test/api/students/'+id+'/activity'),ctx(id))).json();
const payer=await read(1), recipient=await read(2);
assert.equal(payer.summary.totalPaidMinor,28000);
assert.equal(recipient.summary.totalPaidMinor,0);
assert.equal(payer.summary.paidAllowance,4);
assert.equal(recipient.summary.paidAllowance,4);
assert.equal(recipient.summary.paymentCount,0);
assert.equal(recipient.logsCount,1);
assert.equal(payer.logs[0].studentCount,2);
assert.equal(payer.payments[0].students.length,2);
assert.equal(recipient.logs[0].payer.id,1);
assert.equal(recipient.logs[0].amountMinor,null);
assert.equal(recipient.logs[0].id,paymentId);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM school_payment_records').get().n,1);
assert.equal(sqlite.prepare('SELECT SUM(amount_minor) n FROM school_payment_records').get().n,28000);
assert.deepEqual(sqlite.prepare('SELECT paid_allowance n FROM student_course_balances ORDER BY student_id').all().map(row=>row.n),[4,4]);
// Each student's coverage starts with their own first attendance.
sqlite.exec(`INSERT INTO classes(course_id,class_date,start_time) VALUES (1,'2026-01-02','18:00'),(1,'2026-01-09','18:00');
INSERT INTO attendance(student_id,course_id,course_name,attended_at,recorded_by,recorded_at,notes,request_key,request_payload,class_id) VALUES
 (1,1,'Zouk','2026-01-02T18:00:00','admin@test','2026-01-02','', 'group-attendance-1','{}',1),
 (2,1,'Zouk','2026-01-09T18:00:00','admin@test','2026-01-09','', 'group-attendance-2','{}',2)`);
for (const [id,date] of [[1,'2026-01-02T18:00'],[2,'2026-01-09T18:00']]) {
  const result=await read(id), log=result.logs.find(row=>row.kind==='payment');
  assert.equal(log.allocations[0].coverage.classes[0].startsAt,date);
}
async function route(path) { return import(moduleUrl(readFileSync(path,'utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/,'const env = globalThis.activityTestEnv;').replace(/"(?:\.\.\/)+lib\/student-activity"/g,JSON.stringify(helper)))); }
const calendar=await route('app/api/student-calendar/route.ts');
const calendarResult=await (await calendar.GET(new Request('https://school.test/api/student-calendar?studentId=2&from=2026-01-01&to=2026-02-01'))).json();
assert.equal(calendarResult.events.find(row=>row.kind==='payment').paymentId,paymentId);
assert.equal(calendarResult.events.find(row=>row.kind==='payment').coveredClasses[0].startsAt,'2026-01-09T18:00');
const balances=await route('app/api/students/balances/route.ts');
const balanceResult=await (await balances.GET()).json();
for (const student of balanceResult.students) assert.equal(student.balances[0].excessAttendance,0);
// A beneficiary cannot edit or delete the payer's financial record.
assert.equal((await api.PATCH(req('PATCH',{...group,paymentId}),ctx(2))).status,404);
await api.DELETE(req('DELETE',{paymentId}),ctx(2));
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM student_payments').get().n,1);
assert.equal((await api.PATCH(req('PATCH',{...group,paymentId,studentIds:[1,999]}),ctx())).status,409);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM payment_students').get().n,2);
assert.equal((await api.PATCH(req('PATCH',{...group,paymentId,allocations:[{courseId:1,allowance:8}]}),ctx())).status,200);
assert.equal((await read(2)).summary.paidAllowance,8);
assert.equal((await api.PATCH(req('PATCH',{...body,paymentId,studentCount:1,studentIds:[1]}),ctx())).status,200);
assert.equal((await read(2)).summary.paidAllowance,0);
assert.equal((await read(2)).logs.filter(row=>row.kind==='payment').length,0);
assert.equal((await api.PATCH(req('PATCH',{...group,paymentId}),ctx())).status,200);
const exportUrl=moduleUrl(readFileSync('app/api/administrators/export/route.ts','utf8').replace('import { env } from "../../../lib/storage";', 'const env = globalThis.activityTestEnv;'));
const exporter=await import(exportUrl);
const snapshot=await exporter.readExportTables();
assert.equal(snapshot.find(table=>table.name==='payment_students').rows.length,2);
assert.equal(snapshot.find(table=>table.name==='student_payments').rows[0].student_count,2);
const oldSnapshot=snapshot.filter(table=>table.name!=='payment_students').map(table => ['student_payments','payment_presets'].includes(table.name) ? {...table,columns:table.columns.filter(column=>column!=='student_count'),rows:table.rows.map(({student_count,...row})=>row)} : table);
const upgraded=exporter.upgradeTaskTables(oldSnapshot);
assert.equal(upgraded.find(table=>table.name==='student_payments').rows[0].student_count,1);
assert.deepEqual(upgraded.find(table=>table.name==='payment_students').rows,[]);
assert.equal((await api.DELETE(req('DELETE',{paymentId}),ctx())).status,200);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM payment_students').get().n,0);
assert.equal((await read(2)).summary.paidAllowance,0);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM attendance').get().n,2);
console.log('PASS: group count, payer membership, atomic saves/edits, retries, independent credits, activity, calendar, balances, single revenue, and deletion.');

const transfer=await import(moduleUrl(readFileSync('app/lib/local-database-transfer.ts','utf8').replace('"../api/administrators/export/route"',JSON.stringify(exportUrl))));
await transfer.replaceDatabase(db,snapshot);
assert.equal((await read(2)).summary.paidAllowance,4);
assert.equal((await read(2)).logs.find(row=>row.kind==='payment').payer.id,1);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM payment_students').get().n,2);
const presetHelperUrl=moduleUrl(readFileSync('app/lib/payment-presets.ts','utf8').replace('"./student-activity"',JSON.stringify(helper)));
const presetHelper=await import(presetHelperUrl);
const presetRoute=await import(moduleUrl(readFileSync('app/api/payment-presets/route.ts','utf8').replace('import { env } from "../../lib/storage";', 'const env = globalThis.activityTestEnv;').replace('"../../lib/payment-presets"',JSON.stringify(presetHelperUrl))));
const groupPreset={name:'Group package',amount:'280',studentCount:2,allocations:[{courseId:1,allowance:4}]};
for (const studentCount of [0,-1,1.5,'2',10001]) assert.equal(typeof presetHelper.parsePreset({...groupPreset,studentCount}), 'string');
const savedPreset=await presetRoute.POST(req('POST',groupPreset));
assert.equal(savedPreset.status,201);assert.equal((await savedPreset.json()).studentCount,2);
assert.equal((await (await presetRoute.GET()).json()).presets.find(p=>p.name==='Group package').studentCount,2);
console.log('PASS: group preset persistence, export/restore roundtrip, and older single-payment exports.');
