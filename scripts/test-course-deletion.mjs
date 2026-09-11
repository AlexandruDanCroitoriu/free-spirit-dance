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


const helper=moduleUrl(readFileSync('app/lib/courses.ts','utf8'));
const api=await import(moduleUrl(readFileSync('app/api/courses/[id]/route.ts','utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/,'const env = globalThis.activityTestEnv;').replace('"../../../lib/courses"',JSON.stringify(helper))));
const context={params:Promise.resolve({id:'1'})};
const request=new Request('https://school.example.test/api/courses/1');
sqlite.exec("INSERT INTO courses (name) VALUES ('Zouk'); INSERT INTO course_schedule (course_id,day_of_week,start_time,end_time) VALUES (1,'Monday','18:00','19:00')");
sqlite.exec("INSERT INTO classes (course_id,class_date,start_time) VALUES (1,'2026-09-07','18:00'), (1,'2026-09-08','18:00')");
let data=await (await api.GET(request,context)).json();
assert.equal(data.relationships.find(r=>r.table==='course_schedule').count,1);
assert.equal(data.relationships.length,6);
assert.equal(data.relationships.find(r=>r.table==='classes').count,2);
sqlite.exec("INSERT INTO students (first_name,last_name,email) VALUES ('Test','Student','test@example.test'); INSERT INTO student_courses VALUES (1,1)");
assert.equal((await api.DELETE(request,context)).status,409);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM course_schedule').get().n,1, 'blocked deletion rolls back schedule removal');
data=await (await api.GET(request,context)).json();
assert.equal(data.relationships.find(r=>r.table==='student_courses').count,1);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM classes').get().n,2, 'blocked deletion rolls back empty class removal');
sqlite.exec("DELETE FROM student_courses");
sqlite.exec("INSERT INTO admin_profiles (email,name) VALUES ('admin@example.test','Test Admin'); INSERT INTO attendance (student_id,course_id,course_name,attended_at,recorded_by,class_id) VALUES (1,1,'Zouk','2026-09-07T18:00:00','admin@example.test',1)");
assert.equal((await api.DELETE(request,context)).status,409);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM classes').get().n,2, 'attendance blocker preserves all classes');
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM attendance').get().n,1);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM course_schedule').get().n,1);
sqlite.exec("DELETE FROM attendance");
assert.equal((await api.DELETE(request,context)).status,204);
assert.equal((await api.GET(request,context)).status,404);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM course_schedule').get().n,0, 'unused course deletes its schedule');
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM classes').get().n,0, 'unused course deletes empty classes');
console.log('PASS: relationship counts, atomic schedule cleanup and student deletion protection, unlinked deletion and missing course.');
