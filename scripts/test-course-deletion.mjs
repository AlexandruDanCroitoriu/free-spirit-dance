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
const api=await import(moduleUrl(readFileSync('app/api/courses/[id]/route.ts','utf8').replace('import { env } from "cloudflare:workers";','const env = globalThis.activityTestEnv;').replace('"../../../lib/courses"',JSON.stringify(helper))));
const context={params:Promise.resolve({id:'1'})};
const request=new Request('https://school.example.test/api/courses/1');
sqlite.exec("INSERT INTO courses (name) VALUES ('Zouk'); INSERT INTO course_schedule (course_id,day_of_week,start_time,end_time) VALUES (1,'Monday','18:00','19:00')");
let data=await (await api.GET(request,context)).json();
assert.equal(data.relationships.find(r=>r.table==='course_schedule').count,1);
assert.equal(data.relationships.length,6);
assert.equal((await api.DELETE(request,context)).status,409);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM course_schedule').get().n,1);
sqlite.exec("DELETE FROM course_schedule; INSERT INTO students (first_name,last_name,email) VALUES ('Test','Student','test@example.test'); INSERT INTO student_courses VALUES (1,1)");
assert.equal((await api.DELETE(request,context)).status,409);
data=await (await api.GET(request,context)).json();
assert.equal(data.relationships.find(r=>r.table==='student_courses').count,1);
sqlite.exec("DELETE FROM student_courses");
assert.equal((await api.DELETE(request,context)).status,204);
assert.equal((await api.GET(request,context)).status,404);
console.log('PASS: relationship counts, schedule and student deletion protection, unlinked deletion and missing course.');
