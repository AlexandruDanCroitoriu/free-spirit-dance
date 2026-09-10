import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
const directory=resolve('.wrangler/student-panel-test');await mkdir(directory,{recursive:true});
const student={id:1,firstName:'Test',lastName:'Student',email:'test@example.test',phone:'0712345678',picture:null,active:true};
try {
 const source=await readFile('app/components/student-panel.tsx','utf8');
 for(const tab of ['info','logs']) {
  const fixture=source.replace('useState<Student | null>(null)',`useState<Student | null>(${JSON.stringify(student)})`).replace('[loading, setLoading] = useState(true)','[loading, setLoading] = useState(false)').replace('useState<(typeof studentTabs)[number][0]>("logs")',`useState<(typeof studentTabs)[number][0]>(${JSON.stringify(tab)})`);
  const outfile=resolve(directory,tab+'.mjs');await build({stdin:{contents:fixture,resolveDir:resolve('app/components'),loader:'tsx'},outfile,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime']});
  const {default:Panel}=await import(pathToFileURL(outfile).href);
  const html=renderToString(createElement(Panel,{id:1,onClose(){},onUpdate(){},onDelete(){}}));
  assert.match(html,/<dialog[^>]+aria-label="Test Student"/);
  assert.match(html,/right-0 left-auto/);assert.match(html,/Close student panel/);
  assert.equal((html.match(/role="tab"/g)??[]).length,2);
  assert.match(html,new RegExp(`id="student-tab-${tab}" role="tab" aria-selected="true"`));
  assert.match(html,new RegExp(`id="student-panel-${tab}" role="tabpanel" aria-labelledby="student-tab-${tab}">`));
  assert.doesNotMatch(html,/student-tab-courses/);
  assert.match(html,/student-courses-title/);
  assert.doesNotMatch(html,/<main/);
  if(tab==='logs')assert.match(html,/Attendance &amp; payments/);
 }
 const outfile=resolve(directory,'card.mjs');await build({entryPoints:['app/components/student-card.tsx'],outfile,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime']});
 const {default:Card}=await import(pathToFileURL(outfile).href);
 const html=renderToString(createElement(Card,{student,onOpen(){}}));
 assert.match(html,/<button[^>]+aria-haspopup="dialog"/);assert.doesNotMatch(html,/href="\/students\//);
 assert.match(html,/href="tel:0712345678"/);assert.match(html,/href="https:\/\/wa.me\/40712345678"/);
 console.log('PASS: right-side student panel, two tab panels, activity content, and separate profile/call/WhatsApp controls render.');
}finally{await rm(directory,{recursive:true,force:true});}
