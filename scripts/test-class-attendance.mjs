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
for(const dates of [{startDate:'2026-02-30'},{endDate:'2026-09-08'}]) assert.equal(typeof parseCourse({...validCourse,...dates}),'string');
sqlite.exec("INSERT INTO administrator_permissions (email,can_dashboard,can_students,can_courses) VALUES ('both@example.test',1,1,0),('dashboard@example.test',1,0,0),('students@example.test',0,1,0),('courses@example.test',0,0,1)");
const {default:worker}=await import(moduleUrl(readFileSync('worker.ts','utf8').replace(/^import \{ backupManagement.*$/m, 'const localBackupBridgeAuthorized = () => false; const backupManagement = async () => null; const backupsConfigured = () => false; const launchJob = async () => {}; const productionRequest = async (request, env, run) => run(request, env);').replace(/^import \{ localProductionBackupManagement.*$/m, 'const localProductionBackupManagement = async () => null;').replace(/^export \{ (ProductionBackup|LocalBackup).*$/gm, '').replace('import { localProductionRequest } from "./app/lib/production-backups/local-production";', 'const localProductionRequest = async (_request, _env, run) => run();').replace('import { productionImages } from "./app/lib/production-backups/production-storage";', 'const productionImages = async (_db, images) => images;').replace('import { withStorage } from "./app/lib/storage";', 'const withStorage = (_env, callback) => callback();')
  .replace('import { copyBindings, listCopies } from "./app/lib/local-copies";', stripTypeScriptTypes(readFileSync('app/lib/local-copies.ts', 'utf8')).replaceAll('export ', '')).replace('import vinextHandler from "vinext/server/fetch-handler";','const vinextHandler={fetch:()=>new Response("allowed")};')));
for(const method of ['GET','POST']) for(const email of [null,'dashboard@example.test','students@example.test','courses@example.test','both@example.test']) {
 const response=await worker.fetch(new Request('https://school.example.test/api/class-attendance',{method,headers:email?{'cf-access-authenticated-user-email':email}:{}}),{DB:db,PUBLIC_QR_BASE_URL:'https://go.example.test'},{});
 assert.equal(response.status,200);
}
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS: roster grouping, assigned/other/inactive attendance, schedule validation, atomic bulk save, retries, overlapping submissions, distinct class times, balances and page-only access.');

for (const startDate of ["", null, undefined]) assert.equal(parseCourse({...validCourse, startDate}).startDate, null);

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

const classesApi = await import(moduleUrl(readFileSync('app/api/classes/route.ts','utf8').replace('import { env } from "../../lib/storage";', 'const env = globalThis.activityTestEnv;').replace('"../../lib/class-attendance"', JSON.stringify(classUrl))));
const newClass = { courseId: 2, classDate: '2026-09-12', startTime: '15:00', endTime: '16:00', rentCostMinor: 12500 };
const createClass = (patch = {}, authenticated = true) => classesApi.POST(new Request('https://school.example.test/api/classes', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'cf-access-authenticated-user-email': 'admin@example.test' } : {}) }, body: JSON.stringify({ ...newClass, ...patch }) }));
assert.equal((await createClass({}, false)).status, 401);
for (const patch of [{ classDate: '2026-02-30' }, { endTime: '14:00' }, { startTime: '24:00' }, { rentCostMinor: -1 }, { rentCostMinor: 1.5 }]) assert.equal((await createClass(patch)).status, 400);
assert.equal((await createClass({ courseId: 999 })).status, 404);
const weeklyBefore = sqlite.prepare('SELECT * FROM course_schedule').all();
const createdClass = await (await createClass()).json();
assert.ok(createdClass.id);
assert.equal((await (await createClass()).json()).id, createdClass.id, 'Retry returns the same class');
assert.equal((await createClass({ endTime: '17:00' })).status, 409, 'Existing class is preserved');
assert.deepEqual(sqlite.prepare('SELECT * FROM course_schedule').all(), weeklyBefore, 'One-off class does not change weekly schedules');
const addedRoster = await (await get(newClass)).json();
assert.equal(addedRoster.endTime, '16:00');
assert.equal(addedRoster.rentCostMinor, 12500);
assert.equal((await api.POST(request({ ...newClass, studentIds: [1] }))).status, 200, 'One-off class supports attendance');
console.log('PASS: one-off class creation, validation, authentication, retry safety, preserved schedules and attendance.');

const editDetails = (original, details, authenticated = true) => api.PATCH(new Request('https://school.example.test/api/class-attendance', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'cf-access-authenticated-user-email': 'admin@example.test' } : {}) },
  body: JSON.stringify({ ...original, details }),
}));
const details = { courseId: newClass.courseId, classDate: newClass.classDate, startTime: newClass.startTime, endTime: '17:00', rentCostMinor: 15050, rentPaid: true };
assert.equal((await editDetails(newClass, details, false)).status, 401);
for (const invalid of [null, {}, { ...details, classDate: '2026-02-30' }, { ...details, startTime: '25:00' }, { ...details, endTime: '14:59' }, { ...details, rentCostMinor: -1 }, { ...details, rentCostMinor: 1.1 }, { ...details, rentCostMinor: 100_000_000 }, { ...details, rentPaid: 'true' }]) assert.equal((await editDetails(newClass, invalid)).status, 400);
const attendanceBefore = sqlite.prepare('SELECT * FROM attendance WHERE class_id = ?').all(createdClass.id);
assert.equal((await editDetails(newClass, details)).status, 200);
assert.deepEqual(sqlite.prepare('SELECT * FROM attendance WHERE class_id = ?').all(createdClass.id), attendanceBefore, 'Changing rent and end time preserves attendance');
assert.equal((await (await get(newClass)).json()).rentCostMinor, 15050);
assert.equal((await (await get(newClass)).json()).rentPaid, true);
const movedDetails = { ...details, classDate: '2026-09-13', startTime: '16:00', endTime: '18:00' };
assert.equal((await editDetails(newClass, movedDetails)).status, 200);
const movedSlot = { courseId: newClass.courseId, classDate: movedDetails.classDate, startTime: movedDetails.startTime };
const movedRow = sqlite.prepare('SELECT * FROM classes WHERE id = ?').get(createdClass.id);
assert.equal(movedRow.class_date, movedDetails.classDate);
assert.equal(movedRow.start_time, movedDetails.startTime);
assert.equal(movedRow.rent_paid, 1);
assert.deepEqual(sqlite.prepare('SELECT * FROM attendance WHERE class_id = ?').all(createdClass.id).map(row => ({ ...row })), attendanceBefore.map(row => ({ ...row, attended_at: '2026-09-13T16:00:00' })), 'Moving a class preserves IDs, notes, complimentary status and attribution');
assert.equal((await get(newClass)).status, 404, 'A past original occurrence is removed instead of kept as an empty cancellation');
assert.equal((await (await get(movedSlot)).json()).students.find(student => student.id === 1).attended, 1);
assert.equal((await editDetails(newClass, movedDetails)).status, 409, 'Retry cannot duplicate the moved class');
assert.equal((await api.POST(request({ ...movedSlot, studentIds: [2] }))).status, 200, 'Further attendance uses the new time');
assert.equal((await api.POST(request({ ...newClass, studentIds: [3] }))).status, 409, 'Old occurrence cannot receive attendance');
assert.deepEqual(sqlite.prepare('SELECT * FROM course_schedule').all(), weeklyBefore, 'Editing an occurrence preserves weekly schedules');

// Reject both stored and not-yet-materialized recurring destination classes.
sqlite.exec("INSERT INTO course_schedule (course_id,day_of_week,start_time,end_time) VALUES (2,'Monday','16:00','17:00')");
assert.equal((await editDetails(movedSlot, { ...movedDetails, classDate: '2026-09-14' })).status, 409);
assert.equal(sqlite.prepare('SELECT class_date FROM classes WHERE id = ?').get(createdClass.id).class_date, '2026-09-13');

// A failed attendance update rolls back the class move and all associated writes.
sqlite.exec("CREATE TRIGGER fail_test_move BEFORE UPDATE OF attended_at ON attendance WHEN NEW.attended_at = '2026-09-15T16:00:00' BEGIN SELECT RAISE(ABORT, 'test move failure'); END");
assert.equal((await editDetails(movedSlot, { ...movedDetails, classDate: '2026-09-15' })).status, 500);
assert.equal(sqlite.prepare('SELECT class_date FROM classes WHERE id = ?').get(createdClass.id).class_date, '2026-09-13');
assert.equal(sqlite.prepare("SELECT count(*) n FROM classes WHERE course_id = 2 AND class_date = '2026-09-15' AND start_time = '16:00'").get().n, 0);
sqlite.exec('DROP TRIGGER fail_test_move');
console.log('PASS: class details validation, rent editing, attendance-preserving moves, destination conflicts, recurring schedule preservation and atomic rollback.');

const changedCourseDetails = { ...movedDetails, courseId: 1, classDate: '2026-09-13', startTime: '17:00' };
assert.equal((await editDetails(movedSlot, changedCourseDetails)).status, 200);
const changedCourseSlot = { courseId: 1, classDate: changedCourseDetails.classDate, startTime: changedCourseDetails.startTime };
const changedClass = sqlite.prepare('SELECT course_id, class_date, start_time FROM classes WHERE id = ?').get(createdClass.id);
assert.deepEqual({ ...changedClass }, { course_id: 1, class_date: '2026-09-13', start_time: '17:00' });
const changedAttendance = sqlite.prepare('SELECT course_id, course_name, attended_at FROM attendance WHERE class_id = ?').all(createdClass.id);
assert.ok(changedAttendance.every(row => row.course_id === 1 && row.course_name === 'Zouk' && row.attended_at === '2026-09-13T17:00:00'));
assert.equal((await (await get(changedCourseSlot)).json()).courseName, 'Zouk');
assert.equal((await get(movedSlot)).status, 404, 'Changing a past class course removes the prior course occurrence');
assert.equal((await editDetails(changedCourseSlot, { ...changedCourseDetails, courseId: 999 })).status, 404);
console.log('PASS: class course changes preserve recorded attendance and show the target course.');

const removableClass = { ...newClass, classDate: '2026-09-11', startTime: '11:00', endTime: '12:00' };
assert.equal((await createClass(removableClass)).status, 200);
const remove = (target, authenticated = true) => api.DELETE(new Request(`https://school.example.test/api/class-attendance?${new URLSearchParams(target)}`, { headers: authenticated ? { 'cf-access-authenticated-user-email': 'admin@example.test' } : {} }));
assert.equal((await remove(removableClass, false)).status, 401);
assert.equal((await remove(removableClass)).status, 200);
assert.equal((await get(removableClass)).status, 404, 'A past class without attendance can be removed');
assert.equal((await remove(changedCourseSlot)).status, 409, 'A class with attendance cannot be removed');
console.log('PASS: past occurrences are removed after a course move, and empty saved classes can be removed safely.');
