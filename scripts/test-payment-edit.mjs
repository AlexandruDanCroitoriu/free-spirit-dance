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
const api=await import(moduleUrl(readFileSync('app/api/students/[id]/activity/route.ts','utf8').replace('import { env } from "cloudflare:workers";','const env = globalThis.activityTestEnv;').replace('"../../../../lib/student-activity"',JSON.stringify(helper))));
sqlite.exec("INSERT INTO students (first_name,last_name,email) VALUES ('A','Student','a@test'),('B','Student','b@test'); INSERT INTO courses (name) VALUES ('Zouk'),('Basics')");
const ctx=(id=1)=>({params:Promise.resolve({id:String(id)})});
const body={kind:'payment',requestKey:'payment-edit-test-1234',notes:'Original',paidOn:'2026-01-01',amount:'280',allocations:[{courseId:1,allowance:4}]};
const req=(method,data)=>new Request('https://school.test/api/students/1/activity',{method,headers:{'Content-Type':'application/json','cf-access-authenticated-user-email':'admin@test'},body:JSON.stringify(data)});
assert.equal((await api.POST(req('POST',body),ctx())).status,201);
const edit={...body,paymentId:1,amount:'70',notes:'Corrected',allocations:[{courseId:2,allowance:1}]};
assert.equal((await api.PATCH(req('PATCH',edit),ctx(2))).status,404);
assert.equal((await api.PATCH(req('PATCH',edit),ctx())).status,200);
let data=await (await api.GET(new Request('https://school.test/api/students/1/activity'),ctx())).json();
assert.equal(data.summary.totalPaidMinor,7000);assert.equal(data.summary.paidAllowance,1);
assert.equal(data.logs[0].allocations[0].courseId,2);
assert.equal((await api.PATCH(req('PATCH',{...edit,amount:'99',allocations:[{courseId:999,allowance:2}]}),ctx())).status,409);
assert.equal(sqlite.prepare('SELECT amount_minor FROM student_payments').get().amount_minor,7000);
assert.equal(sqlite.prepare('SELECT course_id FROM payment_course_allowances').get().course_id,2);
await api.DELETE(req('DELETE',{paymentId:1}),ctx(2));
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM student_payments').get().n,1);
assert.equal((await api.DELETE(req('DELETE',{paymentId:1}),ctx())).status,200);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM payment_course_allowances').get().n,0);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM student_payments').get().n,0);
console.log('PASS: payment edits, allowance replacement, log course IDs, rollback, student isolation, and deletion.');
