// Optional real-browser interaction suite, with synthetic data only.
// TASK_UI_CHROME=/path/to/chrome node scripts/test-task-ui-browser.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

if (!process.env.TASK_UI_CHROME) {
  console.log('SKIP: task browser interactions (set TASK_UI_CHROME to an installed Chromium executable).');
  process.exit(0);
}
const directory = await mkdtemp(resolve(tmpdir(), 'fsd-task-browser-'));
let chrome, socket, server;
const timeout = setTimeout(() => { console.error('Task browser test timed out.'); chrome?.kill(); process.exit(1); }, 60_000);
try {
  const fixture = `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import TaskBoard from './app/components/task-board'; import {taskColumns} from './app/lib/tasks';
    const student={id:1,firstName:'Test',lastName:'Student',email:'',phone:'',birthDate:null,facebookUrl:'',instagramUrl:'',picture:null,active:true};
    const make=(id,title,status='todo')=>({key:'manual:'+id,title,status,source:'manual',category:'manual',description:'',dueDate:null,student:null,sortOrder:id,dismissed:false,canEditContent:true,canDelete:true,createdBy:'',createdAt:'',updatedBy:'',updatedAt:''});
    window.fixture={tasks:[make(10,'First'),make(2,'Second'),make(3,'Completed','done')],revision:1,columns:taskColumns,views:[{key:'all',title:'All tasks'},{key:'manual',title:'Manual tasks'},{key:'birthday',title:'Student Birthdays'}],today:'2026-09-15',failSave:false,loseCreate:false};
    window.fixture.tasks[0].sortOrder=0;window.fixture.tasks[1].sortOrder=0;
    window.fixture.tasks[2].student={id:1,name:'Test Student'};
    let nextId=4; const creates=new Map();window.moveRequests=[];window.refreshRequests=0;
    window.fetch=async(url,options={})=>{
      const state=window.fixture, method=options.method||'GET', body=JSON.parse(options.body||'{}');
      const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
      if(url==='/api/production-database')return json({readOnly:!!state.readOnly});
      if(url==='/api/tasks/refresh'){window.refreshRequests++;return json(state);}
      if(url==='/api/access-permissions')return json({tasks:true,students:true});
      if(url==='/api/students')return json([student]);
      if(url==='/api/students/1')return json(student);
      if(!url.startsWith('/api/tasks'))return json([]);
      if(method==='GET')return json({...state,tasks:url.includes('studentId=1')?state.tasks.filter(t=>t.student?.id===1):state.tasks});
      if(method==='POST'&&url==='/api/tasks'&&creates.has(body.requestKey))return json(creates.get(body.requestKey));
      if(url==='/api/tasks/move'){
        window.moveRequests.push(body);
        if(state.delayMove)await new Promise(resolve=>window.releaseMove=resolve);
        if(state.failMove){const status=state.failMove;state.failMove=false;return json({error:status===409?'Board changed.':'Save failed.'},status);}
      }
      if(state.failSave){state.failSave=false;state.tasks[0].description='Another administrator changed this';state.revision++;return json({error:'Board changed.'},409);}
      if(body.revision!==state.revision)return json({error:'Board changed.'},409);
      state.revision++;
      if(url==='/api/tasks/move'){
        const task=state.tasks.find(t=>t.key===body.key), rest=state.tasks.filter(t=>t.key!==task.key&&t.status===body.status).sort((a,b)=>a.sortOrder-b.sortOrder);
        const index=body.position==='top'?0:body.position==='bottom'?rest.length:rest.findIndex(t=>t.key===body.targetKey)+(body.position==='after'?1:0);
        task.status=body.status;rest.splice(index,0,task);rest.forEach((t,i)=>t.sortOrder=i);return json(state);
      }
      if(method==='POST'){
        const task={...make(nextId++,body.title),...body,student:body.studentId===1?{id:1,name:'Test Student'}:null};state.tasks.push(task);
        const result={task,revision:state.revision};creates.set(body.requestKey,result);
        if(state.loseCreate){state.loseCreate=false;throw new TypeError('Lost response');}return json(result,201);
      }
      const key=decodeURIComponent(url.split('/').at(-1)), task=state.tasks.find(t=>t.key===key);
      if(method==='DELETE'){state.tasks=state.tasks.filter(t=>t.key!==key);return json({deleted:true,revision:state.revision});}
      Object.assign(task,body);if('studentId' in body)task.student=body.studentId===1?{id:1,name:'Test Student'}:null;
      return json({task,revision:state.revision});
    };
    createRoot(document.getElementById('root')).render(<TaskBoard/>);
  `;
  const bundle = await build({ stdin: { contents: fixture, resolveDir: resolve('.'), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic' });
  const css = await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') });
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : request.url === '/style.css' ? 'text/css' : 'text/html');
    response.end(request.url === '/fixture.js' ? bundle.outputFiles[0].text : request.url === '/style.css' ? css.css : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  chrome = spawn(process.env.TASK_UI_CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = ''; chrome.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/\S+)/); if (match) resolve(match[1]); });
    chrome.on('error', reject); chrome.on('exit', code => reject(new Error(`Chromium exited: ${code}; ${output.slice(-1000)}`)));
  });
  const targets = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let sequence = 0; const pending = new Map(), exceptions = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id) { const action = pending.get(message.id); pending.delete(message.id); message.error ? action.reject(message.error) : action.resolve(message.result); } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails); });
  await call('Runtime.enable'); await call('Page.enable'); await call('Page.bringToFront');
  const evaluate = async expression => { const data = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (data.exceptionDetails) throw new Error(JSON.stringify(data.exceptionDetails)); return data.result.value; };
  const waitFor = async expression => { for (let count = 0; count < 100; count++) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw new Error(`Timed out: ${expression}; ${JSON.stringify(await evaluate("({body:document.body.innerText.slice(0,2500),url:location.href})"))}; exceptions: ${JSON.stringify(exceptions)}`); };
  const click = async label => { await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);if(!button)throw Error('Missing enabled button: '+${JSON.stringify(label)});button.focus();button.click()})()`); };
  const input = async (selector, value) => { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`); };
  const point = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const key = async (name, code, keyCode) => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: keyCode, ...(name === 'Enter' ? { text: '\r' } : {}) }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode }); };
  const drag = async (from, to, cancel = false) => {
    const start = await point(from), end = await point(to);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + 8, y: start.y + 8, buttons: 1 });
    await waitFor(`document.querySelector('[data-dragging=true]')`);
    for (let step = 1; step <= 8; step++) { await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, buttons: 1 }); await pause(35); }
    if (cancel) await key('Escape', 'Escape', 27);
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 });
    await waitFor(`!document.querySelector('[data-dragging=true]')`);
    await waitFor(`!document.getAnimations().some(animation=>animation.playState==='running')`);
  };
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tasks` });
  await waitFor(`document.querySelectorAll('article').length===3`);
  assert.equal(await evaluate(`document.querySelector('article').getAttribute('aria-label')`), 'First'); // Preserve server order on equal imported positions.
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[aria-label="Task board"]')).gridTemplateColumns.split(' ').length`), 3);
  // Mouse sorting uses the same guarded endpoint and keeps controls separate.
  await drag('[aria-label="Drag First"]', '[aria-label="Drag Second"]');
  await waitFor(`window.moveRequests.length===1&&!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`document.querySelector('article').getAttribute('aria-label')`), 'Second');
  assert.deepEqual(await evaluate(`window.moveRequests[0]`), { key: 'manual:10', status: 'todo', position: 'after', targetKey: 'manual:2', revision: 1 });
  assert.equal(await evaluate(`!!document.querySelector('dialog')`), false);
  await click('Refresh'); await waitFor(`!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`document.querySelector('article').getAttribute('aria-label')`), 'Second');
  await drag('[aria-label="Drag First"]', '[aria-labelledby="column-in_progress"] > div');
  await waitFor(`window.fixture.tasks.find(t=>t.title==='First').status==='in_progress'&&!document.querySelector('[aria-busy=true]')`);
  await drag('[aria-label="Drag First"]', '[aria-label="Drag Completed"]');
  await waitFor(`window.fixture.tasks.find(t=>t.title==='First').status==='done'&&!document.querySelector('[aria-busy=true]')`);
  const saved = await evaluate(`JSON.stringify(window.fixture.tasks)`), count = await evaluate(`window.moveRequests.length`);
  await drag('[aria-label="Drag First"]', '[aria-labelledby="column-in_progress"] > div', true);
  assert.equal(await evaluate(`window.moveRequests.length`), count);
  assert.equal(await evaluate(`JSON.stringify(window.fixture.tasks)`), saved);
  await drag('[aria-label="Drag First"]', '#task-board-summary');
  assert.equal(await evaluate(`window.moveRequests.length`), count); // Outside-board drops cancel.
  assert.equal(await evaluate(`JSON.stringify(window.fixture.tasks)`), saved);
  // Pending preview, rollback on server error, then revision-conflict recovery.
  await evaluate(`window.fixture.delayMove=true;window.fixture.failMove=500`);
  await drag('[aria-label="Drag First"]', '[aria-labelledby="column-in_progress"] > div');
  await waitFor(`!!window.releaseMove`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby="column-in_progress"] [aria-label="Drag First"]')`), true);
  await evaluate(`window.fixture.delayMove=false;window.releaseMove()`);
  await waitFor(`document.querySelector('[role=alert]')?.textContent.includes('Save failed')`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby="column-done"] [aria-label="Drag First"]')`), true);
  assert.equal(await evaluate(`JSON.stringify(window.fixture.tasks)`), saved);
  await click('Refresh'); await waitFor(`!document.querySelector('[aria-busy=true]')`);
  await evaluate(`window.fixture.failMove=409`);
  await drag('[aria-label="Drag First"]', '[aria-labelledby="column-in_progress"] > div');
  await waitFor(`document.querySelector('[role=alert]')?.textContent.includes('Board changed')`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby="column-done"] [aria-label="Drag First"]')`), true);
  await click('Refresh'); await waitFor(`!document.querySelector('[aria-busy=true]')`);
  // Keyboard drag can be canceled; screen-reader instructions remain attached.
  await evaluate(`document.querySelector('[aria-label="Drag Second"]').focus()`);
  await key('Enter', 'Enter', 13); await waitFor(`document.querySelector('[data-dragging=true]')`);
  assert.equal(await evaluate(`document.body.textContent.includes('Escape cancels')`), true);
  await key('Escape', 'Escape', 27); await waitFor(`!document.querySelector('[data-dragging=true]')`);
  await waitFor(`!document.getAnimations().some(animation=>animation.playState==='running')`);
  const keyboardCount = await evaluate(`window.moveRequests.length`);
  await evaluate(`document.querySelector('[aria-label="Drag Second"]').focus()`);
  await key('Enter', 'Enter', 13); await waitFor(`document.querySelector('[data-dragging=true]')`);
  await key('ArrowRight', 'ArrowRight', 39); await pause(100);
  await key('Enter', 'Enter', 13);
  await waitFor(`window.moveRequests.length===${keyboardCount + 1}&&!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`window.fixture.tasks.find(t=>t.title==='Second').status`), 'in_progress');
  await waitFor(`!document.getAnimations().some(animation=>animation.playState==='running')`);
  // Touch: a quick tap never moves a task; a deliberate hold then drag does.
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touchStart = await point('[aria-label="Drag First"]'), touchEnd = await point('[aria-labelledby="column-todo"] > div');
  const touchCount = await evaluate(`window.moveRequests.length`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchStart, id: 1 }] });
  await pause(50); await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await evaluate(`window.moveRequests.length`), touchCount);
  assert.equal(await evaluate(`!!document.querySelector('dialog')`), false);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchStart, id: 1 }] });
  await pause(300); await waitFor(`document.querySelector('[data-dragging=true]')`);
  for (let step = 1; step <= 8; step++) { await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchStart.x + (touchEnd.x - touchStart.x) * step / 8, y: touchStart.y + (touchEnd.y - touchStart.y) * step / 8, id: 1 }] }); await pause(35); }
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitFor(`window.moveRequests.length===${touchCount + 1}&&!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`window.fixture.tasks.find(t=>t.title==='First').status`), 'todo');
  await call('Emulation.setTouchEmulationEnabled', { enabled: false });
  // Reset only the synthetic fixture for the existing CRUD/mobile regression suite.
  await call('Page.reload'); await waitFor(`window.fixture?.revision===1&&document.querySelectorAll('article').length===3`);
  if (process.env.TASK_UI_SCREENSHOTS) { const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(resolve(process.env.TASK_UI_SCREENSHOTS, 'tasks-desktop.png'), Buffer.from(shot.data, 'base64')); }
  await click('+ Create task'); await waitFor(`document.querySelector('dialog')?.open`);
  assert.equal(await evaluate(`document.activeElement===document.querySelector('dialog input')`), true);
  await input('dialog input', 'Follow up'); await input('dialog input[type=date]', '2026-09-22');
  await waitFor(`document.querySelector('dialog select:last-of-type')!==null`);
  await input('dialog div > label.mt-2 select', '1');
  await click('Save task'); await waitFor(`!document.querySelector('dialog')&&document.querySelectorAll('article').length===4`);
  assert.equal(await evaluate(`window.fixture.tasks.find(t=>t.title==='Follow up').student?.id`), 1);
  assert.equal(await evaluate(`document.activeElement.textContent`), '+ Create task');
  await evaluate(`document.querySelector('[aria-label="Edit First"]').focus(); document.querySelector('[aria-label="Edit First"]').click(); window.fixture.failSave=true`);
  await input('dialog input', 'My draft'); await click('Save task'); await waitFor(`document.querySelector('[role=alert]')?.textContent.includes('Board changed')`);
  assert.equal(await evaluate(`document.querySelector('dialog input').value`), 'My draft');
  await click('Review latest board'); await waitFor(`document.querySelector('details')?.textContent.includes('Another administrator')`);
  await click('Save task'); await waitFor(`!document.querySelector('dialog')&&document.querySelector('[aria-label="Edit My draft"]')`);
  await waitFor(`document.activeElement.getAttribute('aria-label')==='Edit My draft'`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await waitFor(`document.querySelector('dialog')?.open`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor(`!document.querySelector('dialog')`);
  await waitFor(`document.activeElement.getAttribute('aria-label')==='Edit My draft'`);
  await evaluate(`document.querySelector('[aria-label="Position of My draft"] button:nth-child(2)').focus()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await waitFor(`document.querySelector('article').getAttribute('aria-label')==='Second'`);
  await click('Refresh'); await waitFor(`!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`document.querySelector('article').getAttribute('aria-label')`), 'Second');
  await input('[aria-label="Status for My draft"]', 'done');
  await waitFor(`window.fixture.tasks.find(t=>t.title==='My draft').status==='done'`);
  await evaluate(`document.querySelector('[aria-label="Task filters"] input[type=checkbox]').click()`);
  await waitFor(`document.querySelectorAll('article').length===2`);
  assert.equal(await evaluate(`new URL(location.href).searchParams.get('completed')`), '0');
  await evaluate(`history.back()`); await waitFor(`document.querySelectorAll('article').length===4`);
  await evaluate(`document.querySelector('[aria-label="Edit My draft"]').click()`); await click('Delete task'); await click('Confirm delete');
  await waitFor(`!document.querySelector('dialog')&&document.querySelectorAll('article').length===3`);
  await click('+ Create task'); await input('dialog input', 'Lost save'); await evaluate(`window.fixture.loseCreate=true`); await click('Save task');
  await waitFor(`document.querySelector('dialog fieldset').disabled`); await click('Retry save'); await waitFor(`!document.querySelector('dialog')`);
  assert.equal(await evaluate(`window.fixture.tasks.filter(t=>t.title==='Lost save').length`), 1);
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[aria-label="Task board"]')).gridTemplateColumns.split(' ').length`), 1);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=320`), true);
  assert.equal(await evaluate(`[...document.querySelectorAll('article button,article select')].every(e=>e.getBoundingClientRect().height>=44)`), true);
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  await evaluate(`document.querySelector('article').scrollIntoView({block:'center'})`);
  const scrollStart = await evaluate(`window.scrollY`), scrollPoint = await point('article h3');
  const beforeScrollMoves = await evaluate(`window.moveRequests.length`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...scrollPoint, id: 1 }] });
  for (let step = 1; step <= 6; step++) { await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: scrollPoint.x, y: scrollPoint.y - step * 20, id: 1 }] }); await pause(35); }
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitFor(`window.scrollY>${scrollStart}`);
  assert.equal(await evaluate(`window.moveRequests.length`), beforeScrollMoves);
  await call('Emulation.setTouchEmulationEnabled', { enabled: false });
  await evaluate(`window.scrollTo(0,0)`);
  if (process.env.TASK_UI_SCREENSHOTS) { const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(resolve(process.env.TASK_UI_SCREENSHOTS, 'tasks-mobile.png'), Buffer.from(shot.data, 'base64')); }
  await click('+ Create task'); await waitFor(`document.querySelector('dialog')?.open`);
  assert.equal(await evaluate(`document.querySelector('dialog').scrollWidth<=320`), true);
  await click('Cancel'); await waitFor(`!document.querySelector('dialog')`);
  await evaluate(`document.querySelector('article a').click()`); await waitFor(`document.querySelector('dialog')?.textContent.includes('Student info')`);
  await evaluate(`document.querySelector('#student-tab-info').click()`); await waitFor(`document.querySelector('[aria-label="Linked tasks"]')?.textContent.includes('Follow up')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Linked tasks"]').textContent.includes('Completed')`), true);
  await click('Remove link from Follow up'); await click('Confirm remove link'); await waitFor(`!window.fixture.tasks.find(t=>t.title==='Follow up').student`);
  await click('Remove link from Completed'); await click('Confirm remove link'); await waitFor(`document.querySelector('[aria-label="Linked tasks"]')?.textContent.includes('No linked tasks')`);
  assert.equal(await evaluate(`window.fixture.tasks.find(t=>t.title==='Follow up').student`), null);
  // Automatic occurrences reuse the same cards, movement and mobile filters.
  await call('Page.reload'); await waitFor(`window.fixture?.revision===1&&document.querySelectorAll('article').length===3`);
  await evaluate(`window.fixture.tasks.push({...window.fixture.tasks[0],key:'automatic:birthday:student%3A1:2026',source:'automatic',category:'birthday',title:'Birthday: Test Student',student:{id:1,name:'Test Student'},dueDate:'2026-09-20',canEditContent:false,canDelete:false})`);
  await click('Refresh'); await waitFor(`document.querySelectorAll('article').length===4`);
  await input('[aria-label="Task filters"] select', 'birthday');
  await waitFor(`document.querySelectorAll('article').length===1`);
  assert.equal(await evaluate(`document.querySelector('article').textContent.includes('Automatic · Student Birthdays')`), true);
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Edit Birthday: Test Student"]')`), false);
  await input('[aria-label="Status for Birthday: Test Student"]', 'done');
  await waitFor(`window.fixture.tasks.at(-1).status==='done'&&!document.querySelector('[aria-busy=true]')`);
  await evaluate(`document.querySelector('[aria-label="Task filters"] input').click()`);
  await waitFor(`document.querySelectorAll('article').length===0`);
  await evaluate(`document.querySelector('[aria-label="Task filters"] input').click()`);
  await waitFor(`document.querySelectorAll('article').length===1`);
  await click('Dismiss occurrence'); await waitFor(`document.querySelectorAll('article').length===0`);
  await evaluate(`document.querySelectorAll('[aria-label="Task filters"] input')[1].click()`);
  await waitFor(`document.querySelector('article')?.textContent.includes('Dismissed')`);
  await click('Restore occurrence'); await waitFor(`!window.fixture.tasks.at(-1).dismissed&&!document.querySelector('[aria-busy=true]')`);
  await click('Remove student link'); await click('Confirm unlink');
  await waitFor(`!document.querySelector('article a')&&!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=320`), true);
  assert.equal(await evaluate(`[...document.querySelectorAll('article button,article select')].every(e=>e.getBoundingClientRect().height>=44)`), true);
  const refreshCount = await evaluate(`window.refreshRequests`);
  await evaluate(`window.fixture.readOnly=true`); await click('Refresh');
  await waitFor(`document.querySelector('article select').disabled`);
  assert.equal(await evaluate(`window.refreshRequests`), refreshCount, 'Read-only copies must never synchronize rules.');
  assert.deepEqual(exceptions, []);
  console.log('PASS: mouse/touch/keyboard dragging, empty and populated columns, cancellation, optimistic rollback, stale saves, CRUD, filters, explicit movement, reload ordering, student unlink, mobile layout, focus restoration, automatic views/actions, and read-only refresh.');
  await call('Browser.close');
} finally {
  clearTimeout(timeout); socket?.close(); chrome?.kill(); server?.close();
  await new Promise(resolve => setTimeout(resolve, 100));
  await rm(directory, { recursive: true, force: true });
}
