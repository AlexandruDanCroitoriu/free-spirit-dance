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
const api=await import(moduleUrl(readFileSync('app/api/students/[id]/activity/route.ts','utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/,'const env = globalThis.activityTestEnv;').replace('"../../../../lib/student-activity"',JSON.stringify(helper))));
sqlite.exec("INSERT INTO students (first_name,last_name,email) VALUES ('A','Student','a@test'),('B','Student','b@test'); INSERT INTO courses (name) VALUES ('Zouk'),('Basics')");
const ctx=(id=1)=>({params:Promise.resolve({id:String(id)})});
sqlite.exec("INSERT INTO admin_profiles (email, name) VALUES ('admin@test', ''); INSERT INTO administrator_payment_methods (email, method) VALUES ('admin@test', 'Cash')");
const body={kind:'payment',requestKey:'payment-edit-test-1234',notes:'Original',paidOn:'2026-01-01',amount:'280',receivedMethod:'Cash',allocations:[{courseId:1,allowance:4}]};
const req=(method,data)=>new Request('https://school.test/api/students/1/activity',{method,headers:{'Content-Type':'application/json','cf-access-authenticated-user-email':'admin@test'},body:JSON.stringify(data)});
assert.equal((await api.POST(req('POST',body),ctx())).status,201);

const transfers = await import(moduleUrl(readFileSync('app/api/students/payments/route.ts','utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/,'const env = globalThis.activityTestEnv;')));
const list = async (query = '') => (await transfers.GET(new Request('https://school.test/api/students/payments' + query))).json();
let result = await list();
assert.equal(result.count, 1);
assert.equal(result.payments[0].givenToSchool, 0);
assert.equal(result.payments[0].recordedBy, 'admin@test');
assert.equal(result.totals.pendingMinor, 28000);
assert.deepEqual((await list('?collector=admin%40test')).methods, [{ method: 'Cash' }]);
assert.equal((await list('?collector=admin%40test&method=Cash')).count, 1);
assert.equal((await list('?collector=admin%40test&method=Revolut')).count, 0);
sqlite.exec("INSERT INTO administrator_permissions (email) VALUES ('active@example.test'), ('removed@example.test'); INSERT INTO admin_profiles (email, name) VALUES ('active@example.test', 'Active administrator'), ('removed@example.test', 'Removed administrator')");
assert.deepEqual((await list()).collectors.map((collector) => collector.email), ['active@example.test', 'croitoriu.alexandru.code@gmail.com', 'removed@example.test']);
sqlite.exec("DELETE FROM administrator_permissions WHERE email = 'removed@example.test'");
assert.deepEqual((await list()).collectors.map((collector) => collector.email), ['active@example.test', 'croitoriu.alexandru.code@gmail.com']);
const original = sqlite.prepare('SELECT * FROM student_payments WHERE id = 1').get();
const change = { paymentId: 1, studentId: 1, givenToSchool: true };
assert.equal((await transfers.PATCH(req('PATCH', {...change, givenToSchool:'true'}))).status, 400);
assert.equal((await transfers.PATCH(req('PATCH', {...change, studentId:2}))).status, 404);
assert.equal((await transfers.PATCH(new Request('https://school.test/api/students/payments', {method:'PATCH',body:JSON.stringify(change)}))).status, 401);
assert.equal((await transfers.PATCH(req('PATCH', change))).status, 200);
assert.equal((await transfers.PATCH(req('PATCH', change))).status, 200, 'retry is idempotent');
const updated = sqlite.prepare('SELECT * FROM student_payments WHERE id = 1').get();
assert.deepEqual({...updated}, {...original, given_to_school:1});
assert.equal((await list('?status=pending')).count, 0);
result = await list('?status=given');
assert.equal(result.count, 1);
assert.equal(result.totals.givenMinor, 28000);
assert.equal(result.totals.pendingMinor, 0);
let activity = await (await api.GET(new Request('https://school.test/api/students/1/activity'),ctx())).json();
assert.equal(activity.payments[0].givenToSchool, 1);
assert.equal(activity.logs.find(row => row.kind === 'payment').givenToSchool, 1);
assert.equal((await api.PATCH(req('PATCH', {...body, paymentId:1, notes:'Edited'}),ctx())).status, 200);
assert.equal(sqlite.prepare('SELECT given_to_school FROM student_payments').get().given_to_school, 1);
assert.equal((await transfers.PATCH(req('PATCH', {...change, givenToSchool:false}))).status, 200);
assert.equal((await list('?status=pending')).count, 1);
for (let i = 0; i < 11; i++) assert.equal((await api.POST(req('POST', {...body, requestKey:'payment-transfer-more-' + i}),ctx(2))).status, 201);
result = await list();
assert.equal(result.count, 12);
assert.equal(result.payments.length, 10);
assert.equal((await list('?page=2')).payments.length, 2);
assert.equal((await list('?pageSize=20')).payments.length, 12);
assert.equal((await transfers.GET(new Request('https://school.test/api/students/payments?pageSize=15'))).status, 400);
assert.equal((await transfers.GET(new Request('https://school.test/api/students/payments?page=0'))).status, 400);
assert.equal((await transfers.GET(new Request('https://school.test/api/students/payments?status=invalid'))).status, 400);
console.log('PASS: payment handover validation, isolation, persistence, collector preservation, totals, filters and pagination.');

sqlite.exec("UPDATE student_payments SET paid_on = '2026-02-01', given_to_school = 1 WHERE id = 1; UPDATE student_payments SET paid_on = '2026-03-01' WHERE id = 2");
result = await list('?from=2026-01-01&to=2026-02-01');
assert.equal(result.count, 11, 'both date boundaries are inclusive');
assert.equal(result.payments.length, 10);
assert.deepEqual(result.totals, {pendingMinor:280000, givenMinor:28000}, 'totals include all matching pages');
assert.deepEqual((await list('?from=2026-01-01&to=2026-02-01&page=2')).totals, result.totals);
assert.deepEqual((await list('?from=2026-01-01&to=2026-02-01&status=given')).totals, {pendingMinor:0, givenMinor:28000});
assert.deepEqual((await list('?from=2026-01-01&to=2026-02-01&status=pending')).totals, {pendingMinor:280000, givenMinor:0});
assert.equal((await list('?from=2026-02-01')).count, 2);
assert.equal((await list('?to=2026-01-01')).count, 10);
assert.deepEqual((await list('?from=2026-04-01')).totals, {pendingMinor:0, givenMinor:0});
for (const query of ['?from=2026-02-30', '?to=bad', '?from=2026-03-01&to=2026-01-01']) {
  assert.equal((await transfers.GET(new Request('https://school.test/api/students/payments' + query))).status, 400);
}
console.log('PASS: inclusive date ranges, open boundaries, filtered totals across pages, empty matches and invalid ranges.');

sqlite.exec("UPDATE students SET picture = '/api/student-images/student-test.webp' WHERE id = 1; UPDATE admin_profiles SET name = 'Test Administrator', picture = '/api/student-images/admin-test.webp' WHERE email = 'admin@test'");
result = await list('?from=2026-02-01&to=2026-02-01');
assert.equal(result.payments[0].studentPicture, '/api/student-images/student-test.webp');
assert.equal(result.payments[0].studentEmail, 'a@test');
assert.equal(result.payments[0].administratorName, 'Test Administrator');
assert.equal(result.payments[0].administratorPicture, '/api/student-images/admin-test.webp');
assert.equal(result.payments[0].recordedBy, 'admin@test');
sqlite.exec("UPDATE admin_profiles SET name = '', picture = NULL WHERE email = 'admin@test'");
result = await list('?from=2026-02-01&to=2026-02-01');
assert.equal(result.payments[0].administratorName, '');
assert.equal(result.payments[0].administratorPicture, null);
assert.equal(result.payments[0].recordedBy, 'admin@test', 'email remains available when no name is set');
console.log('PASS: student and collecting administrator profile images, names and fallback email.');
