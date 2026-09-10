import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
const directory = resolve('.wrangler/activity-render-test');
await mkdir(directory, { recursive: true });
const source = await readFile('app/components/student-activity.tsx', 'utf8');
const data = {
  logsPage: 1,
  logs: [{id:1,kind:"attendance",courseId:1,eventDate:"2026-09-03T18:00:00",courseName:"Zouk",amountMinor:null,notes:"<unsafe>",recordedBy:"admin@example.test",recordedAt:null,allocations:[]},{id:1,kind:"payment",eventDate:"2026-09-09",courseName:null,amountMinor:20050,notes:"Cash",recordedBy:"admin@example.test",recordedAt:null,allocations:[{courseId:1,courseName:"Zouk",allowance:2,coverage:{classes:[{startsAt:"2026-09-03T18:00",attended:true},{startsAt:"2026-09-10T18:00",attended:false}],remaining:0}}]}],
  summary: { missedClasses: 2, attendanceCount: 3, paidAllowance: 12, excessAttendance: 1, remainingAllowance: 9, paymentCount: 1, totalPaidMinor: 20050 },
  balances: [{courseId:1,courseName:'Zouk',attendanceCount:3,paidAllowance:2,remainingAllowance:-1,excessAttendance:1}],
  attendance: [{id:1,courseId:1,courseName:'Zouk',attendedAt:'2026-09-09T18:00:00',notes:'<unsafe>',recordedBy:'admin@example.test',recordedAt:'2026-09-09T18:00:00Z'}],
  payments: [{id:1,paidOn:'2026-09-09',amountMinor:20050,allocations:[{courseId:1,courseName:'Zouk',allowance:2}],notes:'Cash',recordedBy:'admin@example.test',recordedAt:'2026-09-09T18:00:00Z'}],
  courses: [{id:1,name:'Zouk'},{id:2,name:'Basics'}], attendancePage: 1, paymentsPage: 1,
};
data.logs.unshift({id:1,kind:"missed",courseId:1,eventDate:"2026-09-10T18:00:00",courseName:"Zouk",amountMinor:null,notes:"",recordedBy:"Automatic",recordedAt:null,allocations:[]});
data.logs.push({id:1,kind:"cancelled",courseId:1,eventDate:"2026-09-04T18:00:00",courseName:"Zouk",amountMinor:null,notes:"",recordedBy:"—",recordedAt:null,allocations:[]});
try {
  for (const [mode, canRecordFuturePayments] of [[null, false], ['payment', false], ['payment', true]]) {
    data.canRecordFuturePayments = canRecordFuturePayments;
    const fixture = source.replace('useState<Activity | null>(null)', `useState<Activity | null>(${JSON.stringify(data)})`)
      .replace('useState<"payment" | null>(null)', `useState<"payment" | null>(${JSON.stringify(mode)})`)
      .replace('useState<PaymentPreset[]>([])', 'useState<PaymentPreset[]>([{id:1,name:"Four classes",amountMinor:20050,allocations:[{courseId:1,courseName:"Zouk",allowance:4}]}])')
      .replace('[loading, setLoading] = useState(true)', '[loading, setLoading] = useState(false)');
    const outfile = resolve(directory, `${mode ?? 'logs'}-${canRecordFuturePayments}.mjs`);
    await build({stdin:{contents:fixture,resolveDir:resolve('app/components'),loader:'tsx'},outfile,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime']});
    const {default: Component} = await import(pathToFileURL(outfile).href);
    const html = renderToString(createElement(Component,{studentId:1})).replaceAll("<!-- -->", "");
    assert.match(html,/Attendances without credit/);
    assert.match(html,/Covered by payment #1/);
    assert.match(html,/03\/09\/2026/);
    assert.doesNotMatch(html,/Not attended · credit used|Classes covered in Zouk/);
    assert.match(html,/border-l-2 border-lime-600/);
    assert.match(html,/Missed classes/);
    const missedRow = html.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*?>Missed<(?:(?!<\/tr>)[\s\S])*?<\/tr>/)?.[0];
    const cancelledRow = html.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*?>Cancelled<(?:(?!<\/tr>)[\s\S])*?<\/tr>/)?.[0];
    assert.ok(cancelledRow);
    assert.match(cancelledRow, /Cancelled · no credit used/);
    assert.doesNotMatch(cancelledRow, /<button|Covered by payment/);
    assert.ok(missedRow, 'a missed activity row renders');
    assert.match(missedRow, /1 missed/);
    assert.match(missedRow, /10\/09\/2026/);
    assert.match(missedRow, /Automatic/);
    assert.match(missedRow, /Covered by payment #1/);
    assert.doesNotMatch(missedRow, /<button/);
    assert.ok(html.indexOf("Class allowance") < html.indexOf("Missed classes"));
    assert.ok(html.indexOf("Missed classes") < html.indexOf("Attendances without credit"));
    assert.match(html,/Free attendance for Zouk on 03\/09\/2026/);
    assert.match(html,/aria-pressed="false"/);
    assert.match(html,/aria-label="Logs pages"/);
    assert.match(html,/Page 1 of 1/);
    assert.match(html,/>Previous<|>Next</);
    assert.match(html,/Activity log/); assert.doesNotMatch(html,/>Record attendance<|>Save attendance</);
    assert.match(html,/Payment/);
    if (mode === "payment") {
      assert.match(html,/200\.50/);
      const dateInput = html.match(/<input[^>]*type="date"[^>]*>/)?.[0];
      assert.ok(dateInput);
      if (canRecordFuturePayments) assert.doesNotMatch(dateInput, / max=/);
      else assert.match(dateInput, / max="\d{4}-\d{2}-\d{2}"/);
    }
    assert.match(html,/Next 2 classes/);
    assert.doesNotMatch(html,/>Details<|<unsafe>/);
    assert.doesNotMatch(html,/earlier allowance|legacy/i);
    if (mode) assert.match(html,/<dialog/);
    if (mode === 'payment') { assert.match(html,/Payment preset/); assert.match(html,/Four classes/); assert.match(html,/Custom payment/); assert.match(html,/Amount received \(RON\)/); assert.match(html,/Classes covered by course/); assert.equal((html.match(/type="checkbox"/g) ?? []).length,2); }
  }
  console.log('PASS: course debt, logs, escaped notes, and payment/attendance popup controls render.');
} finally { await rm(directory,{recursive:true,force:true}); }
