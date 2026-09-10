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


const helper=moduleUrl(readFileSync('app/lib/student-activity.ts','utf8'));
const api=await import(moduleUrl(readFileSync('app/api/students/balances/route.ts','utf8').replace('import { env } from "cloudflare:workers";','const env = globalThis.activityTestEnv;').replace('"../../../lib/student-activity"',JSON.stringify(helper))));
sqlite.exec(`INSERT INTO admin_profiles (email,name) VALUES ('admin@test','Admin');
INSERT INTO students (first_name,last_name,email,active) VALUES ('Unpaid','Student','a@test',0),('Paid','Student','b@test',1),('No activity','Student','c@test',1);
INSERT INTO courses (name,start_date,end_date) VALUES ('Zouk','2020-01-01','2020-01-31'),('Basics','2020-01-01','2020-01-31'),('Future course','2099-01-01',NULL);
INSERT INTO classes (course_id,class_date,start_time) VALUES (1,'2020-01-06','19:00');
INSERT INTO attendance (class_id,student_id,course_id,course_name,attended_at,recorded_by) VALUES (1,1,1,'Zouk','2020-01-06T19:00:00','admin@test'),(1,2,1,'Zouk','2020-01-06T19:00:00','admin@test');
INSERT INTO student_payments (student_id,paid_on,amount_minor,recorded_by,recorded_at,request_key,request_payload) VALUES (2,'2020-01-07',10000,'admin@test','2020-01-07','test-payment-1','{}'),(1,'2020-01-07',10000,'admin@test','2020-01-07','test-payment-2','{}');
INSERT INTO payment_course_allowances VALUES (1,1,'Zouk',3),(2,2,'Basics',1);`);
let response=await api.GET();
assert.equal(response.status,200);
assert.equal(response.headers.get('Cache-Control'),'no-store');
const body=await response.json();
assert.equal(body.courses.length,3,'course filter includes courses without activity, including future courses');
assert.ok(body.courses.some(c=>c.name==='Future course'));
let students=body.students;
assert.equal(students.length,2,'students with no assignment or activity are excluded');
let unpaid=students.find(s=>s.id===1);
assert.equal(unpaid.balances.find(b=>b.courseId===1).excessAttendance,1,'inactive students with debt are included');
assert.equal(unpaid.balances.find(b=>b.courseId===2).remainingAllowance,1,'other course credit does not pay debt');
assert.equal(students.find(s=>s.id===2).balances[0].remainingAllowance,2,'future payment settles prior attendance');
sqlite.exec("INSERT INTO payment_course_allowances VALUES (2,1,'Zouk',4)");
students=(await (await api.GET()).json()).students;
unpaid=students.find(s=>s.id===1);
assert.equal(unpaid.balances.find(b=>b.courseId===1).excessAttendance,0);
assert.equal(unpaid.balances.find(b=>b.courseId===1).remainingAllowance,3);
console.log('PASS: dashboard balances, per-course isolation, inactive debt, retroactive payment and refreshed balances.');

sqlite.exec("INSERT INTO student_courses (student_id, course_id) VALUES (3,1),(3,2),(2,1)");
students=(await (await api.GET()).json()).students;
const enrolled=students.find(s=>s.id===3);
assert.equal(enrolled.balances.length,2,'every assigned course has a balance without activity');
assert.ok(enrolled.balances.every(b=>b.remainingAllowance===0 && b.excessAttendance===0),'new enrollment has zero credits and no unpaid attendance');
assert.ok(students.filter(s=>s.balances.some(b=>b.courseId===2 && b.remainingAllowance===0)).some(s=>s.id===3),'zero-credit course filter includes new student');
assert.equal(students.find(s=>s.id===2).balances.length,1,'assignment and payment do not duplicate balances');
sqlite.exec("DELETE FROM student_courses WHERE student_id=3 AND course_id=1");
students=(await (await api.GET()).json()).students;
assert.deepEqual(students.find(s=>s.id===3).balances.map(b=>b.courseId),[2],'removing an unused assignment removes its balance');
console.log('PASS: assigned students without activity, zero credits, per-course filtering and assignment changes.');
