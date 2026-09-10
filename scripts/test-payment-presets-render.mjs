import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
const directory=resolve('.wrangler/presets-render-test');await mkdir(directory,{recursive:true});
const source=await readFile('app/payments/page.tsx','utf8');
const data={presets:[{id:1,name:'Four Zouk classes',amountMinor:20050,allocations:[{courseId:1,courseName:'Zouk',allowance:4}]}],courses:[{id:1,name:'Zouk'}]};
try {
 for(const mode of ['list','add','edit']) {
  const fixture=source.replace('useState<PresetData | null>(null)',`useState<PresetData | null>(${JSON.stringify(data)})`).replace('[loading, setLoading] = useState(true)','[loading, setLoading] = useState(false)').replace('[open, setOpen] = useState(false)',`[open, setOpen] = useState(${mode!=='list'})`).replace('useState<number | null>(null)',`useState<number | null>(${mode==='edit'?1:'null'})`);
  const outfile=resolve(directory,mode+'.mjs');await build({stdin:{contents:fixture,resolveDir:resolve('app/payments'),loader:'tsx'},outfile,bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime']});
  const {default:Page}=await import(pathToFileURL(outfile).href);const html=renderToString(createElement(Page)).replaceAll('<!-- -->','');
  assert.match(html,/Four Zouk classes/);assert.match(html,/200\.50/);assert.match(html,/Zouk: 4 classes/);assert.match(html,/Edit Four Zouk classes/);
  assert.doesNotMatch(html.split('<dialog')[0], /Delete/);
  if(mode==='edit') assert.match(html, /Delete preset/); else assert.doesNotMatch(html, /Delete preset/);
  if(mode!=='list'){assert.match(html,/right-0 left-auto/);assert.match(html,/Close payment preset panel/);assert.match(html,/<dialog/);assert.match(html,/Preset name/);assert.match(html,/Classes per course/);assert.match(html,/type="checkbox"/);assert.match(html,mode==='edit'?/Edit payment preset/:/Add payment preset/);}
 }
 console.log('PASS: Payments preset table and accessible add/edit popup fields render.');
}finally{await rm(directory,{recursive:true,force:true});}
