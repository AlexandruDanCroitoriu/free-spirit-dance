import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
const directory=resolve('.wrangler/class-attendance-render-test');await mkdir(directory,{recursive:true});
const data={canEdit:true,canManageClass:true,cancelled:false,rentCostMinor:12500,rentPaid:false,courseName:'Zouk',endTime:'19:30',students:[{id:1,firstName:'Assigned',lastName:'Student',picture:null,active:1,assigned:1,attended:0},{id:2,firstName:'Other',lastName:'Dancer',picture:null,active:1,assigned:0,attended:0},{id:3,firstName:'Recorded',lastName:'Student',picture:null,active:1,assigned:0,attended:1},{id:4,firstName:'Inactive',lastName:'Assigned',picture:null,active:0,assigned:1,attended:0}]};
try {
 const source=await readFile('app/components/class-attendance-panel.tsx','utf8');
 {
  const fixture=source.replace('useState<ClassRoster | null>(null)',`useState<ClassRoster | null>(${JSON.stringify(data)})`).replace('[loading, setLoading] = useState(true)','[loading, setLoading] = useState(false)').replace('useState<number[]>([])','useState<number[]>([1,2])');
  const outfile=resolve(directory,'all')+'.mjs';await build({stdin:{contents:fixture,resolveDir:resolve('app/components'),loader:'tsx'},outfile,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime']});
  const {default:Panel,AttendanceStudentCard:Card}=await import(pathToFileURL(outfile).href);
  const html=renderToString(createElement(Panel,{slot:{courseId:1,classDate:'2026-09-09',startTime:'18:30'},courseName:'Zouk',onClose(){}})).replaceAll('<!-- -->','');
  assert.match(html, /role="tab" id="class-attendance-tab"[^>]*aria-selected="true"/);
  assert.match(html, /role="tab" id="class-details-tab"[^>]*aria-selected="false"/);
  assert.doesNotMatch(html, /Save class details|Cancel class|Rent money given/);
  assert.match(html,/Free attendance for Assigned Student/);
  assert.match(html,/Free attendance for Recorded Student/);
  assert.doesNotMatch(html,/Free attendance for Inactive Assigned/);
  assert.match(html,/flex items-center gap-2 overflow-hidden rounded-xl/);
  assert.doesNotMatch(html,/px-3 pb-3/);
  assert.match(html,/<dialog/);assert.match(html,/md:left-auto/);assert.match(html,/Selected students \(1\)/);assert.match(html,/Assigned students \(1\)/);assert.match(html,/Other students \(1\)/);
  assert.ok(html.indexOf('Recorded Student')<html.indexOf('Assigned Student'));assert.ok(html.indexOf('Assigned Student')<html.indexOf('Other Dancer'));assert.match(html,/2 changes · 1 recorded/);assert.match(html,/Submit attendance/);assert.match(html,/bg-green-50/);
  assert.match(html,/Recorded Student/);assert.match(html,/>Recorded</);
  const selected=renderToString(createElement(Card,{student:data.students[0],selected:true,disabled:false,onToggle(){}}));assert.match(selected,/aria-pressed="true"/);assert.match(selected,/border-green-500 bg-green-50/);
  const recorded=renderToString(createElement(Card,{student:data.students[2],selected:true,disabled:false,onToggle(){}}));assert.doesNotMatch(recorded,/disabled=""/);assert.match(recorded,/>Remove</);assert.match(recorded,/aria-pressed="false"/);
  const locked=renderToString(createElement(Card,{student:data.students[2],selected:false,disabled:true,onToggle(){}}));assert.match(locked,/disabled=""/);assert.match(locked,/>Recorded</);

 }
 {
  const fixture=source.replace('useState<ClassRoster | null>(null)',`useState<ClassRoster | null>(${JSON.stringify(data)})`).replace('[loading, setLoading] = useState(true)','[loading, setLoading] = useState(false)').replace('useState<"attendance" | "details">("attendance")','useState<"attendance" | "details">("details")');
  const outfile=resolve(directory,'details.mjs');
  await build({stdin:{contents:fixture,resolveDir:resolve('app/components'),loader:'tsx'},outfile,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime']});
  const {default:Panel}=await import(pathToFileURL(outfile).href);
  const html=renderToString(createElement(Panel,{slot:{courseId:1,classDate:'2026-09-09',startTime:'18:30'},courseName:'Zouk',onClose(){}}));
  assert.match(html, /role="tab" id="class-details-tab"[^>]*aria-selected="true"/);
  for (const text of ['class-details-panel', 'type="date"', 'Start time (Bucharest)', 'End time (Bucharest)', 'Rent cost (RON)', 'Rent money given', 'Save class details', 'Cancel class']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Submit attendance|Assigned students|Other students/);
 }
 console.log('PASS: class sidebar, assigned-first cards, green selections, recorded states, and future-date controls render.');
}finally{await rm(directory,{recursive:true,force:true});}
