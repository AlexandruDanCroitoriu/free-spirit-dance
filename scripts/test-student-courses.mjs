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
globalThis.studentCoursesTestEnv = { DB: db };
function moduleUrl(source) {
  const js = stripTypeScriptTypes(source);
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const api = await import(moduleUrl(readFileSync("app/api/students/[id]/courses/route.ts", "utf8").replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.studentCoursesTestEnv;')));
const context = (id) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (body) => new Request("https://example.test/api/students/1/courses", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
sqlite.exec("INSERT INTO students (first_name,last_name,email) VALUES ('A','Test','a@example.test'),('B','Test','b@example.test'); INSERT INTO courses (name) VALUES ('Zouk'),('Basics'),('Practice')");
const assigned = () => sqlite.prepare("SELECT course_id FROM student_courses WHERE student_id=1 ORDER BY course_id").all().map(row => row.course_id);
assert.equal((await api.GET(request({}),context(999))).status,404);
assert.equal((await api.PUT(request({courseIds:[1]}),context('bad'))).status,400);
assert.equal((await api.PUT(request({courseIds:[1]}),context(999))).status,404);
assert.equal((await api.PUT(request({courseIds:[1,2]}),context(1))).status,200);
assert.deepEqual(assigned(),[1,2]);
assert.equal((await api.PUT(request({courseIds:[1,2]}),context(1))).status,200);
for (const courseIds of [[1,1],['1'],[-1],[1.5],null]) assert.equal((await api.PUT(request({courseIds}),context(1))).status,400);
assert.equal((await api.PUT(request({courseIds:[3,999]}),context(1))).status,409);
assert.deepEqual(assigned(),[1,2], 'Failed save must preserve existing assignments');
assert.equal((await api.PUT(request({courseIds:[2,3]}),context(1))).status,200);
assert.deepEqual(assigned(),[2,3]);
assert.equal((await (await api.GET(request({}),context(2))).json()).filter(c=>c.assigned).length,0);
assert.throws(()=>sqlite.exec('DELETE FROM courses WHERE id=2'),/FOREIGN KEY/);
assert.equal((await api.PUT(request({courseIds:[]}),context(1))).status,200);
assert.deepEqual(assigned(),[]);
await api.PUT(request({courseIds:[1]}),context(1));
sqlite.exec('DELETE FROM students WHERE id=1');
assert.deepEqual(assigned(),[]);
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS: multiple assignments, updates, removal, validation, rollback, student isolation and deletion constraints.');

const studentsApi = await import(moduleUrl(readFileSync("app/api/students/route.ts", "utf8").replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.studentCoursesTestEnv;')));
const create = (extra) => studentsApi.POST(new Request("https://example.test/api/students", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ firstName: "New", lastName: "Student", email: "", phone: "", ...extra }) }));
const created = await create({courseIds:[1,2,3]});
assert.equal(created.status,201);
const newStudent = await created.json();
assert.deepEqual(sqlite.prepare("SELECT course_id FROM student_courses WHERE student_id=? ORDER BY course_id").all(newStudent.id).map(row=>row.course_id),[1,2,3]);
const count = () => sqlite.prepare("SELECT count(*) AS n FROM students").get().n;
const before = count();
assert.equal((await create({courseIds:[1,999]})).status,409);
assert.equal(count(),before,"Invalid courses must roll back student creation");
for (const courseIds of [[1,1], ["1"], null, [-1]]) assert.equal((await create({courseIds})).status,400);
assert.equal((await create({courseIds:[]})).status,201);
assert.equal((await create({})).status,201);
console.log("PASS: creation assigns multiple courses, validates input, supports no courses, and rolls back on missing courses.");

const directory = await (await studentsApi.GET()).json();
assert.deepEqual(directory.map(student => student.id), directory.map(student => student.id).sort((a,b)=>a-b));
assert.deepEqual(directory.find(student => student.id === newStudent.id).courseIds.sort((a,b)=>a-b), [1,2,3]);
assert.deepEqual(directory.at(-1).courseIds, []);
console.log("PASS: student directory preserves creation order and includes course assignments for filtering.");
