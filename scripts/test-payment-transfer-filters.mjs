import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { stripTypeScriptTypes } from "node:module";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const name of readdirSync("migrations").filter((name) => name.endsWith(".sql") && name < "0052").sort()) sqlite.exec(readFileSync("migrations/" + name, "utf8"));
function prepare(sql) {
  let values = [];
  const statement = {
    bind(...args) { assert.ok(args.length <= 100, "D1 queries allow at most 100 bound parameters"); values = args; return statement; },
    async first() { return sqlite.prepare(sql).get(...values) ?? null; },
    async run() { return statement.execute(); },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    execute() {
      const query = sqlite.prepare(sql);
      const results = query.columns().length ? query.all(...values) : (query.run(...values), []);
      return { results, meta: { last_row_id: sqlite.prepare("SELECT last_insert_rowid() AS id").get().id, changes: sqlite.prepare("SELECT changes() AS n").get().n } };
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



sqlite.exec(`
INSERT INTO admin_profiles (email,name) VALUES ('a@test','A'),('b@test','B'),('c@test','C');
INSERT INTO payment_transfer_filters (administrator_email,collector_email,payment_kind,created_at)
VALUES ('a@test','b@test','course','now'), ('a@test','a@test','multiple_courses','now');
`);
sqlite.exec(readFileSync('migrations/0052_payment_transfer_filter_collectors.sql','utf8'));
sqlite.exec(readFileSync('migrations/0072_free_events.sql','utf8'));
sqlite.exec(readFileSync('migrations/0073_free_event_reports.sql','utf8'));
assert.equal(sqlite.prepare('SELECT collector_emails FROM payment_transfer_filters WHERE id=1').get().collector_emails, '["b@test"]');
assert.equal(sqlite.prepare('SELECT collector_emails FROM payment_transfer_filters WHERE id=2').get().collector_emails, '[]');
const api = await import(moduleUrl(readFileSync('app/api/payment-transfer-filters/route.ts','utf8').replace('import { env } from "../../lib/storage";', 'const env = globalThis.activityTestEnv;')));
const req = (method, body, query='', actor='a@test') => new Request('https://school.test/api/payment-transfer-filters'+query, {method,headers:{'Content-Type':'application/json','cf-access-authenticated-user-email':actor},...(body ? {body:JSON.stringify(body)} : {})});
sqlite.exec("INSERT INTO students (first_name,last_name,email) VALUES ('Test','Student','student@test')");
for (const [i,email,paidOn] of [[1,'a@test','2026-09-01'],[2,'b@test','2026-09-30'],[3,'c@test','2026-09-01'],[4,'a@test','2026-08-31']]) {
  sqlite.prepare("INSERT INTO student_payments (student_id,paid_on,amount_minor,recorded_by,recorded_at,request_key,request_payload) VALUES (1,?,1000,?,'now',?,'{}')").run(paidOn,email,'test-'+i);
}
sqlite.exec(`
INSERT INTO practice_parties (starts_at,starts_utc,duration_minutes,recorded_by,recorded_at,request_key) VALUES ('2026-09-01T19:00','2026-09-01T16:00:00Z',60,'a@test','now','party');
INSERT INTO practice_attendance (student_id,practice_id,recorded_by,recorded_at,donation_amount_minor,donation_paid_on,donation_recorded_by,donation_recorded_at) VALUES (1,1,'b@test','now',500,'2026-09-15','b@test','now');
`);
const selection = {collectorEmails:[' A@TEST ','b@test','a@test'],fromDate:'2026-09-01',toDate:'2026-09-30',paymentTypes:['course','practice_party']};
const created = await api.POST(req('POST', selection));
assert.equal(created.status,201);
const {id} = await created.json();
const row = async () => (await (await api.GET(req('GET'))).json()).filters.find(row=>row.id===id);
assert.deepEqual((await row()).collectorEmails,['a@test','b@test']);
assert.equal((await row()).totalMinor,2500);
assert.equal((await row()).paymentCount,3);
assert.equal((await (await api.GET(req('GET',null,'?id='+id))).json()).payments.length,3);
assert.equal((await api.GET(req('GET',null,'?id='+id,'c@test'))).status,404);
assert.equal((await api.PATCH(req('PATCH',{id,...selection},'','c@test'))).status,404);
assert.equal((await api.POST(req('POST',{giveAllForFilterId:id},'','c@test'))).status,404);
assert.equal((await (await api.POST(req('POST',{giveAllForFilterId:id}))).json()).updated,3);
assert.equal((await row()).allGiven,1);
assert.equal(sqlite.prepare('SELECT given_to_school FROM student_payments WHERE id=3').get().given_to_school,0);
assert.equal(sqlite.prepare('SELECT given_to_school FROM student_payments WHERE id=4').get().given_to_school,0);
assert.equal((await api.PATCH(req('PATCH',{id,...selection,collectorEmails:[]}))).status,200);
assert.equal((await row()).paymentCount,0);
assert.equal((await (await api.GET(req('GET',null,'?id='+id))).json()).payments.length,0);
assert.equal((await (await api.POST(req('POST',{giveAllForFilterId:id}))).json()).updated,0);
for (const collectorEmails of ['a@test',[null],[''],[42]]) assert.equal((await api.PATCH(req('PATCH',{id,...selection,collectorEmails}))).status,400);
assert.equal((await api.PATCH(req('PATCH',{id,...selection,collectorEmails:['missing@test']}))).status,404);
assert.equal((await api.PATCH(req('PATCH',{id,collectorEmail:'b@test',paymentTypes:['course']}))).status,200);
assert.deepEqual((await row()).collectorEmails,['b@test']);
assert.equal((await row()).totalMinor,1000);
assert.equal((await api.POST(req('POST',{empty:true}))).status,201);
console.log('PASS: legacy migration, multi-collector persistence, totals, details, bulk handover, ownership, empty selections and validation.');

// A large report must keep its details and course allocations in sync with totals.
assert.equal((await api.PATCH(req('PATCH',{id,...selection}))).status,200);
sqlite.exec("INSERT INTO courses (name) VALUES ('Regression course')");
for (let index = 0; index < 390; index++) {
  const payment = sqlite.prepare("INSERT INTO student_payments (student_id,paid_on,amount_minor,recorded_by,recorded_at,request_key,request_payload) VALUES (1,'2026-09-15',100,'a@test','now',?,'{}') RETURNING id").get('large-report-'+index);
  sqlite.prepare("INSERT INTO payment_course_allowances (payment_id,course_id,course_name,allowance) VALUES (?,1,'Regression course',4)").run(payment.id);
}
const detailsResponse = await api.GET(req('GET',null,'?id='+id));
assert.equal(detailsResponse.status,200);
const details = (await detailsResponse.json()).payments;
assert.equal(details.length,393);
assert.equal(details.length,(await row()).paymentCount);
assert.equal(details.reduce((sum,payment)=>sum+payment.amountMinor,0),(await row()).totalMinor);
assert.equal(details.filter(payment=>payment.allocations.some(allocation=>allocation.courseName==='Regression course' && allocation.allowance===4)).length,390);
assert.ok(details.filter(payment=>payment.purpose==='practice_donation').every(payment=>payment.allocations.length===0));
console.log('PASS: 393-payment report loads all details and allocations within D1 parameter limits.');

sqlite.exec(`
INSERT INTO free_events (id,name,created_by,created_at,updated_at) VALUES
 (1,'Community Zouk','a@test','now','now'),(2,'Open dance','a@test','now','now');
INSERT INTO free_event_meetings (id,event_id,name,starts_at,starts_utc,duration_minutes,space_rent_minor,accepts_donations,created_by,created_at,updated_at) VALUES
 (1,1,'Friday meetup','2026-09-15T20:00','2026-09-15T17:00:00Z',120,0,1,'a@test','now','now'),
 (2,2,'Other event','2026-09-15T20:00','2026-09-15T17:00:00Z',120,0,1,'a@test','now','now');
INSERT INTO free_event_attendance (meeting_id,student_id,recorded_by,recorded_at,donation_amount_minor) VALUES
 (1,1,'a@test','2026-09-15T17:00:00Z',2500),(2,1,'a@test','2026-09-15T17:00:00Z',9000);
`);
assert.equal((await api.PATCH(req('PATCH',{id,...selection,paymentTypes:['free_event:1']}))).status,200);
assert.equal((await row()).totalMinor,2500);
assert.equal((await row()).paymentCount,1);
const eventDetails = (await (await api.GET(req('GET',null,'?id='+id))).json()).payments;
assert.equal(eventDetails[0].purpose,'free_event_donation');
assert.equal(eventDetails[0].meetingId,1);
assert.equal(eventDetails[0].eventName,'Community Zouk');
assert.deepEqual(eventDetails[0].allocations,[]);
assert.equal((await (await api.GET(req('GET'))).json()).events.length,2);
assert.equal((await (await api.POST(req('POST',{giveAllForFilterId:id}))).json()).updated,1);
assert.equal((await row()).allGiven,1);
assert.equal(sqlite.prepare('SELECT donation_given_to_school AS given FROM free_event_attendance WHERE meeting_id=2').get().given,0);
for (const type of ['free_event:0','free_event:1 OR 1=1','free_event:-1']) {
  assert.equal((await api.PATCH(req('PATCH',{id,...selection,paymentTypes:[type]}))).status,400);
}
console.log('PASS: event options, selected-event donation totals/details, bulk transfers and filter validation.');
