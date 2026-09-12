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
function moduleUrl(source) {
  const js = stripTypeScriptTypes(source);
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const activityUrl=moduleUrl(readFileSync('app/lib/student-activity.ts','utf8'));
const classUrl=moduleUrl(readFileSync('app/lib/class-attendance.ts','utf8'));
const {schoolToday}=await import(activityUrl);
const api=await import(moduleUrl(readFileSync('app/api/class-attendance/route.ts','utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/,'const env = globalThis.activityTestEnv;').replace('"../../lib/class-attendance"',JSON.stringify(classUrl)).replace('"../../lib/student-activity"',JSON.stringify(activityUrl))));
const slot={courseId:1,classDate:'2026-09-09',startTime:'18:30'};
const request=(extra={},email='croitoriu.alexandru.code@gmail.com')=>new Request('https://school.example.test/api/class-attendance',{method:'POST',headers:{'Content-Type':'application/json',...(email?{'cf-access-authenticated-user-email':email}:{})},body:JSON.stringify({...slot,studentIds:[1,2],...extra})});
const get=(extra={})=>api.GET(new Request('https://school.example.test/api/class-attendance?'+new URLSearchParams({...slot,...extra})));
sqlite.exec("INSERT INTO students (first_name,last_name,email,active) VALUES ('Assigned','Student','a@example.test',1),('Other','Student','b@example.test',1),('Inactive','Student','c@example.test',0); INSERT INTO courses (name) VALUES ('Zouk'),('Basics'); INSERT INTO course_schedule (course_id,day_of_week,start_time,end_time) VALUES (1,'Wednesday','18:30','19:30'),(1,'Wednesday','20:00','21:00'); INSERT INTO student_courses VALUES (1,1),(3,1),(2,2)");
let roster=await (await get()).json();assert.equal(roster.students.length,3);assert.deepEqual(roster.students.filter(s=>s.assigned).map(s=>s.id).sort(),[1,3]);assert.equal(roster.students.find(s=>s.id===2).assigned,0);
assert.equal((await api.POST(request({},null))).status,401);
for(const extra of [{studentIds:[]},{studentIds:[1,1]},{studentIds:['1']},{studentIds:[1.5]},{classDate:'2026-02-30'},{startTime:'25:00'}])assert.equal((await api.POST(request(extra))).status,400);
assert.equal((await api.POST(request({startTime:'19:00'}))).status,409);
assert.equal((await get({startTime:'19:00'})).status,404);
assert.equal((await api.POST(request({studentIds:[1,999]}))).status,409);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,0,'Whole submission rolls back on missing student');
assert.equal((await api.POST(request())).status,200);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,2);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM student_payments').get().n,0,'No payment required for attendance');
assert.equal((await (await api.POST(request())).json()).recorded,0,'Repeated submission does not duplicate');
roster=await (await get()).json();assert.equal(roster.students.filter(s=>s.attended).length,2);
assert.equal((await (await api.POST(request({studentIds:[2,3]}))).json()).recorded,1,'Overlapping submissions add only new students');
assert.equal((await (await api.POST(request({studentIds:[1],startTime:'20:00'}))).json()).recorded,1,'Second scheduled class on same date is independent');
assert.equal(sqlite.prepare('SELECT attendance_count FROM student_course_balances WHERE student_id=1 AND course_id=1').get().attendance_count,2);
assert.equal(sqlite.prepare('SELECT course_name FROM attendance LIMIT 1').get().course_name,'Zouk');
assert.equal(sqlite.prepare('SELECT recorded_by FROM attendance LIMIT 1').get().recorded_by,'croitoriu.alexandru.code@gmail.com');
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM student_courses WHERE student_id=2 AND course_id=1').get().n,0,'Attendance does not silently enroll a student');

// Administrators can change attendance on any scheduled past or future date.
for (const classDate of ['2000-01-05', '2099-01-07']) {
  assert.equal((await api.POST(request({classDate, studentIds:[1]}, 'admin@example.test'))).status,200);
  assert.equal((await api.POST(request({classDate, studentIds:[1]}))).status,200);
  assert.equal((await api.POST(request({classDate, studentIds:[], removeStudentIds:[1]}))).status,200);
}
const today = schoolToday();
const weekday = new Intl.DateTimeFormat('en-GB',{weekday:'long',timeZone:'UTC'}).format(new Date(today+'T12:00:00Z'));
sqlite.prepare("INSERT INTO course_schedule (course_id,day_of_week,start_time,end_time) VALUES (2,?,'10:00','11:00')").run(weekday);
const todaySlot = {courseId:2,classDate:today,startTime:'10:00',studentIds:[1]};
assert.equal((await api.POST(request(todaySlot,'admin@example.test'))).status,200);
let removal = await (await api.POST(request({...todaySlot,studentIds:[],removeStudentIds:[1]},'admin@example.test'))).json();
assert.equal(removal.removed,1);
assert.equal((await (await api.POST(request({...todaySlot,studentIds:[],removeStudentIds:[1]},'admin@example.test'))).json()).removed,0);
assert.equal((await api.POST(request(todaySlot,'admin@example.test'))).status,200,'Removed attendance can be added again');
assert.equal((await api.POST(request({...todaySlot,removeStudentIds:[1]}))).status,400,'Conflicting changes rejected');
assert.equal((await api.POST(request({...todaySlot,studentIds:[999],removeStudentIds:[1]}))).status,409);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM attendance WHERE student_id=1 AND course_id=2").get().n,1,'Failed addition rolls back removal');

sqlite.exec("UPDATE courses SET start_date='2026-09-09', end_date='2026-09-16' WHERE id=1");
for (const classDate of ['2026-09-02','2026-09-23']) {
 assert.equal((await get({classDate})).status,404);
 assert.equal((await api.POST(request({classDate,studentIds:[1]}))).status,409);
}
for (const classDate of ['2026-09-09','2026-09-16']) assert.equal((await get({classDate})).status,200);
const {parseCourse}=await import(moduleUrl(readFileSync('app/lib/courses.ts','utf8')));
const validCourse={name:'Zouk',startDate:'2026-09-09',endDate:'2026-09-16',schedules:[{day:'Wednesday',startTime:'18:30',endTime:'19:30',rentCostMinor:0}]};
assert.equal(typeof parseCourse(validCourse),'object');
for(const dates of [{startDate:'2026-02-30'},{endDate:'2026-09-08'},{startDate:''}]) assert.equal(typeof parseCourse({...validCourse,...dates}),'string');
sqlite.exec("INSERT INTO administrator_permissions (email,can_dashboard,can_students,can_courses) VALUES ('both@example.test',1,1,0),('dashboard@example.test',1,0,0),('students@example.test',0,1,0),('courses@example.test',0,0,1)");
const {default:worker}=await import(moduleUrl(readFileSync('worker.ts','utf8').replace('import { withStorage } from "./app/lib/storage";', 'const withStorage = (_env, callback) => callback();').replace('import vinextHandler from "vinext/server/fetch-handler";','const vinextHandler={fetch:()=>new Response("allowed")};')));
for(const method of ['GET','POST']) for(const email of [null,'dashboard@example.test','students@example.test','courses@example.test','both@example.test']) {
 const response=await worker.fetch(new Request('https://school.example.test/api/class-attendance',{method,headers:email?{'cf-access-authenticated-user-email':email}:{}}),{DB:db,PUBLIC_QR_BASE_URL:'https://go.example.test'},{});
 assert.equal(response.status,200);
}
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS: roster grouping, assigned/other/inactive attendance, schedule validation, atomic bulk save, retries, overlapping submissions, distinct class times, balances and page-only access.');

for (const endDate of ["", null, undefined]) assert.equal(parseCourse({...validCourse, endDate}).endDate, null);

const cancellationRequest = (cancelled, extra={}) => new Request('https://school.example.test/api/class-attendance', {method:'PATCH',headers:{'Content-Type':'application/json','cf-access-authenticated-user-email':'admin@example.test'},body:JSON.stringify({...slot,classDate:'2026-09-16',cancelled,...extra})});
assert.equal((await api.PATCH(cancellationRequest(true))).status,200);
assert.equal((await (await get({classDate:'2026-09-16'})).json()).cancelled,true);
assert.equal((await api.POST(request({classDate:'2026-09-16',studentIds:[1]}))).status,409);
assert.equal((await get({classDate:'2026-09-09'})).status,200);
assert.equal((await api.PATCH(cancellationRequest(false))).status,200);
assert.equal((await api.POST(request({classDate:'2026-09-16',studentIds:[1]}))).status,200);
assert.equal((await api.PATCH(cancellationRequest(true))).status,409);
console.log('PASS: cancellation, restoration, occurrence isolation and attendance protection.');

const stored = sqlite.prepare("SELECT id FROM classes WHERE course_id=1 AND class_date='2026-09-16' AND start_time='18:30'").get();
assert.ok(stored);
assert.equal(sqlite.prepare("SELECT class_id FROM attendance WHERE course_id=1 AND attended_at='2026-09-16T18:30:00' LIMIT 1").get().class_id,stored.id);
sqlite.exec("DELETE FROM course_schedule WHERE course_id=1");
assert.equal((await get({classDate:'2026-09-16'})).status,200,'Stored class survives schedule changes');
console.log('PASS: attendance references class and stored occurrences survive schedule changes.');

const freeInput = { classDate: '2026-09-16', studentIds: [2], complimentaryStudentIds: [2], complimentaryReason: ' Trial class ' };
assert.equal((await api.POST(request({ ...freeInput, complimentaryStudentIds: [3] }))).status, 400);
assert.equal((await api.POST(request({ ...freeInput, complimentaryReason: 'x'.repeat(501) }))).status, 400);
assert.equal((await api.POST(request(freeInput))).status, 200);
assert.equal((await api.POST(request(freeInput))).status, 200);
const freeRow = sqlite.prepare("SELECT complimentary, notes, recorded_by FROM attendance WHERE student_id=2 AND attended_at='2026-09-16T18:30:00'").get();
assert.equal(freeRow.complimentary, 1);
assert.equal(freeRow.notes, 'Trial class');
assert.equal(freeRow.recorded_by, 'croitoriu.alexandru.code@gmail.com');
assert.equal((await (await get({classDate:'2026-09-16'})).json()).students.find(s=>s.id===2).complimentary,1);
assert.equal((await api.POST(request({ ...freeInput, studentIds:[3,999], complimentaryStudentIds:[3] }))).status,409);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM attendance WHERE student_id=3 AND attended_at='2026-09-16T18:30:00'").get().n,0);
console.log('PASS: complimentary attendance validates grants, records attribution, retries safely and rolls back invalid submissions.');

// Ordinary attendance administrators can grant a complimentary class on today's date.
sqlite.prepare("INSERT INTO classes (course_id,class_date,start_time,end_time) VALUES (2,?,'12:00','13:00') ON CONFLICT DO NOTHING").run(schoolToday());
assert.equal((await api.POST(request({ courseId:2, classDate:schoolToday(), startTime:'12:00', studentIds:[3], complimentaryStudentIds:[3] }, 'both@example.test'))).status,200);
assert.equal(sqlite.prepare("SELECT complimentary FROM attendance WHERE student_id=3 AND course_id=2 AND attended_at=?").get(schoolToday()+'T12:00:00').complimentary,1);
const activityApi = await import(moduleUrl(readFileSync('app/api/students/[id]/activity/route.ts','utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.activityTestEnv;').replace('"../../../../lib/student-activity"', JSON.stringify(activityUrl))));
const freeActivity = await (await activityApi.GET(new Request('https://school.example.test/api/students/2/activity'), {params:Promise.resolve({id:'2'})})).json();
assert.ok(freeActivity.logs.some(log=>log.kind==='attendance' && log.complimentary===1 && log.notes==='Trial class'));
console.log('PASS: ordinary administrator complimentary grants and student log attribution.');

const existingToggle = { classDate:'2026-09-16', studentIds:[], complimentaryChanges:[{studentId:2,complimentary:false}] };
assert.equal((await api.POST(request(existingToggle))).status,200);
assert.equal(sqlite.prepare("SELECT complimentary FROM attendance WHERE student_id=2 AND attended_at='2026-09-16T18:30:00'").get().complimentary,0);
assert.equal((await api.POST(request({...existingToggle, complimentaryChanges:[{studentId:2,complimentary:true}]}))).status,200);
assert.equal((await api.POST(request({...existingToggle, complimentaryChanges:[{studentId:999,complimentary:true}]}))).status,409);
assert.equal((await api.POST(request({...existingToggle, removeStudentIds:[2]}))).status,400);
const toggled = sqlite.prepare("SELECT notes, recorded_by FROM attendance WHERE student_id=2 AND attended_at='2026-09-16T18:30:00'").get();
assert.match(toggled.notes,/Trial class/);
assert.doesNotMatch(toggled.notes,/Complimentary removed by/);
assert.doesNotMatch(toggled.notes,/Complimentary granted by/);
console.log('PASS: existing attendance complimentary status can be toggled with preserved notes and administrator attribution.');
