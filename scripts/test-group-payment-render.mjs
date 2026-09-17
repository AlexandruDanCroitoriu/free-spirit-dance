import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
const directory = resolve('.wrangler/group-payment-render-test');
await mkdir(directory, {recursive:true});
async function render(source, name, props={}) {
  const outfile=resolve(directory,name+'.mjs');
  await build({stdin:{contents:source,resolveDir:resolve('app/components'),loader:'tsx'},outfile,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime']});
  const {default: Component}=await import(pathToFileURL(outfile).href);
  return renderToString(createElement(Component,props)).replaceAll('<!-- -->','');
}
const students=[{id:1,firstName:'First',lastName:'Payer',picture:'/api/student-images/test.jpg'},{id:2,firstName:'Second',lastName:'Student',picture:null}];
try {
  const fields=await readFile('app/components/payment-group-fields.tsx','utf8');
  const props={payerId:1,group:true,count:'2',selected:[1],onGroup(){},onCount(){},onSelected(){}};
  const html=await render(fields.replace('useState<PaymentStudent[]>([])',`useState<PaymentStudent[]>(${JSON.stringify(students)})`).replace('[loading, setLoading] = useState(true)','[loading, setLoading] = useState(false)').replace('[open, setOpen] = useState(false)','[open, setOpen] = useState(true)'), 'fields',props);
  assert.match(html,/type="number" min="2" max="10000" step="1"/);
  assert.doesNotMatch(html,/<details/); assert.match(html,/aria-expanded="true"/); assert.match(html,/1 \/ 2 selected/);
  assert.doesNotMatch(html,/type="checkbox"/);
  assert.match(html,/<button[^>]*aria-pressed="true" aria-disabled="true"[^>]*bg-lime-100/);
  assert.match(html,/<button[^>]*aria-pressed="false" aria-disabled="false"/);
  assert.equal((html.match(/src="\/api\/student-images\/test.jpg"/g) ?? []).length,2, 'Payer image appears in selected field and option');
  const closed=await render(fields.replace('useState<PaymentStudent[]>([])',`useState<PaymentStudent[]>(${JSON.stringify(students)})`),'closed',{...props,selected:[1,2]});
  assert.match(closed,/aria-expanded="false"/);
  assert.match(closed,/First Payer/); assert.match(closed,/Second Student/);
  assert.doesNotMatch(closed,/type="checkbox"/);
  assert.match(html,/Select exactly 2 students before saving/);
  assert.doesNotMatch(await render(fields,'single',{...props,group:false}),/type="number"|Covered students/);
  const log={id:1,kind:'payment',studentCount:2,payer:students[0],students,eventDate:'2026-01-01',amountMinor:28000,notes:'Group package',recordedBy:'admin@test',recordedAt:null,allocations:[{courseId:1,courseName:'Zouk',allowance:4}]};
  const data={logs:[log],courses:[{id:1,name:'Zouk'}],summary:{attendanceCount:0,paidAllowance:4,missedClasses:0,excessAttendance:0},payments:[],balances:[]};
  const activity=await readFile('app/components/student-activity.tsx','utf8');
  const fixture=d=>activity.replace('useState<Activity | null>(null)',`useState<Activity | null>(${JSON.stringify(d)})`).replace('[loading, setLoading] = useState(true)','[loading, setLoading] = useState(false)');
  const payer=await render(fixture(data),'payer',{studentId:1,targetPaymentId:1});
  assert.match(payer,/Group payment/);assert.match(payer,/280\.00/);assert.match(payer,/Covers: First Payer, Second Student/);assert.match(payer,/Edit payment/);
  const recipient=await render(fixture({...data,logs:[{...log,amountMinor:null}]}),'recipient',{studentId:2});
  assert.match(recipient,/Paid by First Payer/);assert.match(recipient,/src="\/api\/student-images\/test.jpg"/);
  assert.doesNotMatch(recipient,/href="\/students\?/);
  assert.match(recipient,/<button[^>]*>Open payer’s payment<\/button>/);
  assert.match(recipient,/Open payer’s payment/);assert.doesNotMatch(recipient,/Edit payment|280\.00/);
  const presets=await readFile('app/components/payment-presets.tsx','utf8');
  const presetData={presets:[],courses:[{id:1,name:'Zouk'}]};
  const presetHtml=await render(presets.replace('useState<PresetData | null>(null)',`useState<PresetData | null>(${JSON.stringify(presetData)})`).replace('[open, setOpen] = useState(false)','[open, setOpen] = useState(true)').replace('[group, setGroup] = useState(false)','[group, setGroup] = useState(true)'), 'preset');
  assert.match(presetHtml,/Payment type/);assert.match(presetHtml,/Number of students/);assert.match(presetHtml,/type="number" min="2"/);
  console.log('PASS: group form count, multiselect, locked payer, single toggle, payer configuration, recipient avatar and exact payment link.');
} finally {await rm(directory,{recursive:true,force:true});}
