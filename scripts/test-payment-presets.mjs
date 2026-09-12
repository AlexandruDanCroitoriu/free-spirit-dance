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
globalThis.presetTestEnv = { DB: db };
function moduleUrl(source) {
  const js = stripTypeScriptTypes(source);
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}

const activityUrl = moduleUrl(readFileSync('app/lib/student-activity.ts','utf8'));
const helperUrl = moduleUrl(readFileSync('app/lib/payment-presets.ts','utf8').replace('"./student-activity"',JSON.stringify(activityUrl)));
const helper = await import(helperUrl);
async function route(path) { return import(moduleUrl(readFileSync(path,'utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.presetTestEnv;').replace(/"(?:\.\.\/)+lib\/payment-presets"/g,JSON.stringify(helperUrl)).replace('"../../../../lib/student-activity"',JSON.stringify(activityUrl)))); }
const courseHelperUrl = moduleUrl(readFileSync('app/lib/courses.ts', 'utf8'));
const courses = await import(moduleUrl(readFileSync('app/api/courses/route.ts', 'utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.presetTestEnv;').replace('"../../lib/courses"', JSON.stringify(courseHelperUrl))));
const courseItem = await import(moduleUrl(readFileSync('app/api/courses/[id]/route.ts', 'utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.presetTestEnv;').replace('"../../../lib/courses"', JSON.stringify(courseHelperUrl))));
const collection=await route('app/api/payment-presets/route.ts');
const item=await route('app/api/payment-presets/[id]/route.ts');
const activity=await route('app/api/students/[id]/activity/route.ts');
const context=(id)=>({params:Promise.resolve({id:String(id)})});
const request=(body)=>new Request('https://example.test/api/payment-presets',{method:'POST',headers:{'Content-Type':'application/json','cf-access-authenticated-user-email':'admin@example.test'},body:JSON.stringify(body)});
sqlite.exec("INSERT INTO courses (name) VALUES ('Zouk'),('Basics'); INSERT INTO students (first_name,last_name,email) VALUES ('Test','Student','test@example.test')");
const courseWithPreset = await courses.POST(new Request('https://example.test/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Intermediate Zouk', startDate: '2026-09-01', endDate: '', schedules: [{ day: 'Monday', startTime: '18:00', endTime: '19:00', rentCostMinor: 0 }], paymentPreset: { amountMinor: 20000, allowance: 4 } }) }));
assert.equal(courseWithPreset.status, 201);
const coursePreset = sqlite.prepare("SELECT p.name, p.amount_minor AS amountMinor, a.allowance FROM payment_presets p JOIN payment_preset_courses a ON a.preset_id = p.id WHERE a.course_id = 3").get();
assert.equal(coursePreset.name, 'Intermediate Zouk'); assert.equal(coursePreset.amountMinor, 20000); assert.equal(coursePreset.allowance, 4);
const updatedCourse = await courseItem.PATCH(new Request('https://example.test/api/courses/3', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Advanced Zouk', startDate: '2026-09-01', endDate: '', schedules: [{ day: 'Monday', startTime: '18:00', endTime: '19:00', rentCostMinor: 0 }], paymentPreset: { amountMinor: 25000, allowance: 5 } }) }), context(3));
assert.equal(updatedCourse.status, 200);
const updatedCoursePreset = sqlite.prepare("SELECT p.name, p.amount_minor AS amountMinor, a.allowance FROM payment_presets p JOIN payment_preset_courses a ON a.preset_id = p.id WHERE a.course_id = 3").get();
assert.equal(updatedCoursePreset.name, 'Advanced Zouk'); assert.equal(updatedCoursePreset.amountMinor, 25000); assert.equal(updatedCoursePreset.allowance, 5);
const input={name:'Four classes',amount:'200,50',allocations:[{courseId:1,allowance:4},{courseId:2,allowance:2}]};
for(const bad of [{...input,name:''},{...input,amount:'0'},{...input,allocations:[]},{...input,allocations:[{courseId:1,allowance:0}]},{...input,allocations:[{courseId:1,allowance:1.5}]},{...input,allocations:[{courseId:1,allowance:1},{courseId:1,allowance:2}]}]) assert.equal((await collection.POST(request(bad))).status,400);
const created=await collection.POST(request(input));assert.equal(created.status,201);const preset=await created.json();assert.equal(preset.amountMinor,20050);assert.equal(preset.allocations.length,2);
assert.equal((await collection.POST(request({...input,name:'four CLASSES'}))).status,409);
const list=await (await collection.GET()).json();assert.equal(list.presets.length,2);assert.equal(list.courses.length,3);assert.equal(list.presets.find(item => item.courseId !== null).name, 'Advanced Zouk');
assert.equal((await item.PATCH(request({...input,allocations:[{courseId:999,allowance:1}]}),context(preset.id))).status,409);
assert.deepEqual((await (await collection.GET()).json()).presets.find(item => item.id === preset.id),preset,'Invalid changes must roll back');
const draft=helper.presetDraft(preset);assert.equal(draft.amount,'200.50');assert.deepEqual(draft.allocations,{'1':'4','2':'2'});
sqlite.exec("INSERT INTO admin_profiles (email, name) VALUES ('admin@example.test', ''); INSERT INTO administrator_payment_methods (email, method) VALUES ('admin@example.test', 'Cash')");
const payment={kind:'payment',requestKey:'preset-payment-test-123',notes:'',paidOn:'2026-09-09',amount:draft.amount,receivedMethod:'Cash',allocations:Object.entries(draft.allocations).map(([id,n])=>({courseId:Number(id),allowance:Number(n)}))};
assert.equal((await activity.POST(request(payment),context(1))).status,201);
const originalPayment=sqlite.prepare('SELECT * FROM student_payments').all();const originalAllowances=sqlite.prepare('SELECT * FROM payment_course_allowances').all();
assert.equal((await item.PATCH(request({...input,name:'Updated',amount:'250',allocations:[{courseId:2,allowance:8}]}),context(preset.id))).status,200);
assert.equal((await item.DELETE(request({}),context(preset.id))).status,204);
assert.deepEqual(sqlite.prepare('SELECT * FROM student_payments').all(),originalPayment);assert.deepEqual(sqlite.prepare('SELECT * FROM payment_course_allowances').all(),originalAllowances);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payment_preset_courses').get().n,1);
assert.equal((await item.DELETE(request({}),context(preset.id))).status,404);
assert.equal((await item.PATCH(request(input),context(999))).status,404);
assert.equal((await item.DELETE(request({}),context('bad'))).status,400);
const workerSource=readFileSync('worker.ts','utf8').replace('import { withStorage } from "./app/lib/storage";', 'const withStorage = (_env, callback) => callback();').replace('import vinextHandler from "vinext/server/fetch-handler";','const vinextHandler = { fetch: () => new Response("allowed") };');
const {default:worker}=await import(moduleUrl(workerSource));
sqlite.exec("INSERT INTO administrator_permissions (email,can_students,can_courses) VALUES ('students@example.test',1,0),('courses@example.test',0,1)");
for(const path of ['/api/payment-presets','/api/payment-presets/1']) for(const method of ['GET','POST','PATCH','DELETE']) {
 const fetchAs=(email)=>worker.fetch(new Request('https://school.example.test'+path,{method,headers:email?{'cf-access-authenticated-user-email':email}:{}}),{DB:db,PUBLIC_QR_BASE_URL:'https://go.example.test'},{});
 assert.equal((await fetchAs(null)).status,200);assert.equal((await fetchAs('courses@example.test')).status,200);assert.equal((await fetchAs('students@example.test')).status,200);
}
for (const path of ['/api/administrators', '/api/administrators/students%40example.test']) {
 const fetchAs = (email) => worker.fetch(new Request('https://school.example.test' + path, { method: 'DELETE', headers: email ? { 'cf-access-authenticated-user-email': email } : {} }), { DB: db, PUBLIC_QR_BASE_URL: 'https://go.example.test' }, {});
 assert.equal((await fetchAs('students@example.test')).status, 403);
 assert.equal((await fetchAs('croitoriu.alexandru.code@gmail.com')).status, 200);
}
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
console.log('PASS: preset create/edit/delete, validation, rollback, exact amounts, popup defaults, payment history preservation, and permissions.');

// Permission editing persists independently and is reflected in identity responses.
const adminUrl = moduleUrl(readFileSync('app/api/administrators/route.ts', 'utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.presetTestEnv;'));
const admins = await import(adminUrl);
const adminItem = await import(moduleUrl(readFileSync('app/api/administrators/[email]/route.ts', 'utf8').replace(/import \{ env \} from "(?:\.\.\/)+lib\/storage";/, 'const env = globalThis.presetTestEnv;').replace('"../route"', JSON.stringify(adminUrl))));
const identity = await route('app/api/access-permissions/route.ts');
const adminContext = { params: Promise.resolve({ email: 'students@example.test' }) };
const permissions = { dashboard: false, students: true, courses: false, practiceParties: true, qrCodes: false };
const response = await adminItem.PATCH(request(permissions), adminContext);
assert.equal(response.status, 200);
assert.equal((await response.json()).practiceParties, true);
const deletion = await adminItem.DELETE(new Request('https://school.example.test/api/administrators/students%40example.test', { method: 'DELETE' }), adminContext);
assert.equal(deletion.status, 204);
assert.equal(sqlite.prepare("SELECT email FROM administrator_permissions WHERE email = 'students@example.test'").get(), undefined);
assert.equal((await adminItem.DELETE(new Request('https://school.example.test/api/administrators/students%40example.test', { method: 'DELETE' }), adminContext)).status, 404);
console.log('PASS: Practice Parties access is managed independently through administrator APIs.');
