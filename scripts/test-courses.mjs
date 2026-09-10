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
    async run() { return statement.execute(); },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
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
globalThis.courseTestEnv = { DB: db };
function moduleUrl(source) {
  const js = stripTypeScriptTypes(source);
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const helperUrl = moduleUrl(readFileSync("app/lib/courses.ts", "utf8"));
const helper = await import(helperUrl);
async function route(path) {
  return import(moduleUrl(readFileSync(path, "utf8")
    .replace('import { env } from "cloudflare:workers";', "const env = globalThis.courseTestEnv;")
    .replace(/"\.\.\/(?:\.\.\/)*lib\/courses"/g, JSON.stringify(helperUrl))));
}
const collection = await route("app/api/courses/route.ts");
const item = await route("app/api/courses/[id]/route.ts");
const request = (body) => new Request("http://localhost/api/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const context = (id) => ({ params: Promise.resolve({ id: String(id) }) });
const schedules = helper.weekdays.slice(0,5).map(day => ({ day, startTime: "18:00", endTime: "19:00" }));
const input = { name: "Five classes", startDate: "2026-09-01", endDate: null, schedules };
for (const bad of [[], [...schedules,schedules[0]], [schedules[0],schedules[0]], [{...schedules[0],endTime:"17:00"}], [{...schedules[0],day:"Invalid"}]]) {
 assert.equal((await collection.POST(request({...input,schedules:bad}))).status,400);
}
let response=await collection.POST(request(input));
assert.equal(response.status,201);
const created=await response.json();
assert.deepEqual(created.schedules,schedules);
assert.deepEqual((await (await collection.GET()).json())[0].schedules,schedules);
response=await item.PATCH(request({...input,name:"Edited",schedules:schedules.slice(0,3)}),context(created.id));
assert.equal(response.status,200);
assert.equal((await response.json()).schedules.length,3);
response=await item.PATCH(request({...input,schedules:[]}),context(created.id));
assert.equal(response.status,400);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM course_schedule").get().n,3);
sqlite.exec("INSERT INTO students (first_name,last_name,email) VALUES ('Test','Student','test@example.test'); INSERT INTO admin_profiles (email,name) VALUES ('admin@example.test','Test')");
sqlite.prepare("INSERT INTO student_courses (student_id,course_id) VALUES (1,?)").run(created.id);
assert.equal((await item.DELETE(request({}),context(created.id))).status,409);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM course_schedule").get().n,3);
assert.equal((await item.PATCH(request(input),context(999))).status,404);
console.log("PASS: five-class create/read, edit/removal, validation and linked-course deletion rollback.");
sqlite.close();
