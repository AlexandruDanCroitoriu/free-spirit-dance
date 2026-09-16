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
    import TaskBoard from './app/components/task-board';
    import StudentTasks from './app/components/student-tasks';
    const student={id:1,firstName:'Test',lastName:'Student',email:'',phone:'',birthDate:null,facebookUrl:'',instagramUrl:'',picture:null,active:true};
    const make=(id,title,listId=1)=>({key:'manual:'+id,title,source:'manual',category:'manual',listId,description:'',dueDate:null,students:[],sortOrder:id,canDelete:true,createdBy:'',createdAt:'',updatedBy:'',updatedAt:''});
    window.fixture={inboxColor:'default',tasks:[make(10,'First'),make(2,'Second'),make(3,'Completed',3)],revision:1,boards:[{id:1,name:'School',scope:'school'}],lists:[{id:1,boardId:1,title:'This Week',sortOrder:0},{id:2,boardId:1,title:'Planning',sortOrder:1},{id:3,boardId:1,title:'Finished',sortOrder:2}],views:[{key:'all',title:'All tasks'},{key:'manual',title:'Manual tasks'}],today:'2026-09-15',failSave:false,loseCreate:false};
    window.fixture.tasks[0].sortOrder=0;window.fixture.tasks[1].sortOrder=0;
    window.fixture.tasks[2].students=[{id:1,name:'Test Student',picture:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}];
    if (location.pathname === '/student-linked') sessionStorage.setItem('linked-fixture', 'true');
    if (sessionStorage.getItem('linked-fixture')) {
      window.fixture.boards.push({id:2,name:'Personal',scope:'personal'});
      window.fixture.lists.push({id:4,boardId:2,title:'Private list',sortOrder:0});
      window.fixture.tasks=[make(1,'School linked'),make(2,'Personal linked',4),make(3,'Inbox linked',null),make(4,'Done linked')];
      window.fixture.tasks.forEach(task=>{task.status=task.key==='manual:4'?'done':'in_progress';task.students=[{id:1,name:'Test Student',picture:null}];});
    }
    let nextId=4; const creates=new Map();window.moveRequests=[];window.refreshRequests=0;window.listMoves=[];
    window.fetch=async(url,options={})=>{
      const state=window.fixture, method=options.method||'GET', body=JSON.parse(options.body||'{}');
      const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
      if(url==='/api/production-database')return json({readOnly:!!state.readOnly});
      if(url==='/api/tasks'&&method==='GET')window.refreshRequests++;
      if(url==='/api/tasks/administrators')return json([]);
      if(url==='/api/access-permissions')return json({tasks:true,students:true});
      if(url==='/api/students')return json([student,{...student,id:2,firstName:'Another',picture:window.fixture.tasks[2].students[0].picture}]);
      if(url==='/api/students/1/activity')return json({courses:[],payments:[],logs:[],summary:{attendanceCount:0,paidAllowance:0,excessAttendance:0}});
      if(url==='/api/students/1')return json(student);
      if(!url.startsWith('/api/tasks'))return json([]);
      if(url==='/api/tasks/appearance'||url==='/api/tasks/lists/move'){
        if(state.failLayout){state.failLayout=false;return json({error:'Layout changed.'},409);}
        if(body.revision!==state.revision)return json({error:'Board changed.'},409);
        state.revision++;
        if(url.endsWith('appearance')) {
          if(body.target==='inbox')state.inboxColor=body.color;
          if(body.target==='list')state.lists.find(list=>list.id===body.listId).color=body.color;
          if(body.target==='board') {
            let board=state.boards.find(board=>board.scope===body.scope);
            if(!board){board={id:2,name:'Personal',scope:'personal'};state.boards.push(board);}
            board.color=body.color;
          }
        } else {
          window.listMoves.push(body);
          const source=state.lists.find(list=>list.id===body.listId), rest=state.lists.filter(list=>list.boardId===source.boardId&&list.id!==source.id).sort((a,b)=>a.sortOrder-b.sortOrder);
          rest.splice(rest.findIndex(list=>list.id===body.targetId)+(body.position==='after'?1:0),0,source);rest.forEach((list,index)=>list.sortOrder=index);state.lists.sort((a,b)=>a.sortOrder-b.sortOrder);
        }
        return json(state);
      }
      if(method==='DELETE'&&url.startsWith('/api/tasks/lists/')){
        if(body.revision!==state.revision)return json({error:'Board changed.'},409);
        const id=Number(url.slice('/api/tasks/lists/'.length));
        if(state.tasks.some(task=>task.listId===id))return json({error:'Move or delete all cards before removing this list.'},409);
        state.revision++;state.lists=state.lists.filter(list=>list.id!==id);return json(state);
      }
      if(url==='/api/tasks/lists'){
        if(body.revision!==state.revision)return json({error:'Board changed.'},409);
        state.revision++;
        let board=state.boards.find(board=>board.scope===body.scope);
        if(!board){board={id:2,name:'Personal',scope:'personal'};state.boards.push(board);}
        const id=Math.max(0,...state.lists.map(item=>item.id))+1;
        state.lists.push({id,boardId:board.id,title:body.name,sortOrder:state.lists.length});
        return json({...state,createdId:id},201);
      }
      if(method==='GET')return json({...state,tasks:url.includes('studentId=1')?state.tasks.filter(t=>t.students.some(s=>s.id===1)):state.tasks});
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
        const task=state.tasks.find(t=>t.key===body.key), rest=state.tasks.filter(t=>t.key!==task.key&&t.listId===(body.listId===undefined?task.listId:body.listId)).sort((a,b)=>a.sortOrder-b.sortOrder);
        const index=body.position==='top'?0:body.position==='bottom'?rest.length:rest.findIndex(t=>t.key===body.targetKey)+(body.position==='after'?1:0);
        task.listId=body.listId===undefined?task.listId:body.listId;rest.splice(index,0,task);rest.forEach((t,i)=>t.sortOrder=i);return json(state);
      }
      if(method==='POST'){
        const task={...make(nextId++,body.title),...body,students:(body.studentIds||[]).map(id=>({id,name:id===1?'Test Student':'Another Student',picture:null}))};state.tasks.push(task);
        const result={task,revision:state.revision};creates.set(body.requestKey,result);
        if(state.loseCreate){state.loseCreate=false;throw new TypeError('Lost response');}return json(result,201);
      }
      const key=decodeURIComponent(url.split('/').at(-1)), task=state.tasks.find(t=>t.key===key);
      if(method==='DELETE'){state.tasks=state.tasks.filter(t=>t.key!==key);return json({deleted:true,revision:state.revision});}
      Object.assign(task,body);if('studentIds' in body)task.students=body.studentIds.map(id=>({id,name:id===1?'Test Student':'Another Student',picture:null}));
      return json({task,revision:state.revision});
    };
    createRoot(document.getElementById('root')).render(location.pathname === '/student-linked' ? <StudentTasks studentId={1}/> : <TaskBoard/>);
  `;
  const bundle = await build({ stdin: { contents: fixture, resolveDir: resolve('.'), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic' });
  const css = await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') });
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'text/javascript' : request.url === '/style.css' ? 'text/css' : 'text/html');
    response.end(request.url === '/fixture.js' ? bundle.outputFiles[0].text : request.url === '/style.css' ? css.css : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><header><div id="task-page-header-actions" class="task-scrollbar flex min-w-0 max-w-full items-center overflow-x-auto"></div></header><div id="root"></div><script src="/fixture.js"></script>');
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
  const click = async label => { await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})&&!b.disabled&&b.getClientRects().length);if(!button)throw Error('Missing enabled button: '+${JSON.stringify(label)});button.focus();button.click()})()`); };
  const input = async (selector, value) => { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`); };
  const point = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const refreshBoard = async () => {
    const before = await evaluate('window.refreshRequests');
    await evaluate(`(()=>{const retry=[...document.querySelectorAll('[role="alert"] button')].find(button=>button.textContent==='Refresh');if(retry)retry.click();else window.dispatchEvent(new Event('focus'))})()`);
    await waitFor(`window.refreshRequests>${before}&&!document.querySelector('[aria-busy=true]')`);
    await pause(50);
  };
  const key = async (name, code, keyCode) => { await call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: keyCode, ...(name === 'Enter' ? { text: '\r' } : {}) }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode }); };
  const drag = async (from, to, cancel = false, hold = false) => {
    const start = await point(from), end = await point(to);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', clickCount: 1 });
    if (hold) await pause(300);
    else await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+12,y:start.y,buttons:1});
    await waitFor(`document.querySelector('[data-dragging=true]')`);
    for (let step = 1; step <= 8; step++) { await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, buttons: 1 }); await pause(35); }
    if (cancel) await key('Escape', 'Escape', 27);
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 });
    await waitFor(`!document.querySelector('[data-dragging=true]')`);
    await waitFor(`!document.getAnimations().some(animation=>animation.playState==='running')`);
    assert.equal(await evaluate(`!!document.querySelector('dialog')`),false,'Dragging must not open the card editor.');
    await pause(360);
  };
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/student-linked` });
  await waitFor(`document.querySelectorAll('[aria-label="Linked tasks"] li').length===3`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Linked tasks"]').textContent.includes('Done linked')`),false);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Linked tasks"]').textContent.includes('Remove link')`),false);
  await evaluate(`localStorage.setItem('fsd-task-board-scope','school');localStorage.setItem('fsd-task-list-statuses',JSON.stringify({'personal:4':['in_progress']}));document.querySelector('a[href="/tasks?highlight=manual%3A2"]').click()`);
  await waitFor(`document.getElementById('task-manual:2')?.classList.contains('task-card-highlight')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Board scope"] [aria-pressed="true"]').textContent`),'Personal');
  assert.equal(await evaluate(`!!document.querySelector('dialog')`),false);
  assert.equal(await evaluate(`document.activeElement.textContent`),'Personal linked');
  await evaluate(`localStorage.setItem('tasks-inbox-size',JSON.stringify({width:0,height:0}))`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tasks?highlight=manual%3A3` });
  await waitFor(`document.getElementById('task-manual:3')?.classList.contains('task-card-highlight')`);
  assert.ok(await evaluate(`document.getElementById('task-inbox').getBoundingClientRect().height`)>100);
  assert.equal(await evaluate(`document.activeElement.textContent`),'Inbox linked');
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await evaluate(`localStorage.setItem('fsd-task-list-statuses',JSON.stringify({'school:1':['in_progress']}))`);
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tasks?highlight=manual%3A1&studentId=999` });
  await waitFor(`document.getElementById('task-manual:1')?.classList.contains('task-card-highlight')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Board scope"] [aria-pressed="true"]').textContent`),'School');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('task-manual:1')).animationName`),'none');
  assert.equal(await evaluate(`document.activeElement.textContent`),'School linked');
  assert.deepEqual(exceptions,[]);
  console.log('PASS: student links show only in-progress tasks without unlink actions; School, Personal and collapsed mobile Inbox destinations reveal and highlight the card despite filters, with reduced-motion support.');
  await call('Emulation.setEmulatedMedia', { features: [] });
  await evaluate(`sessionStorage.removeItem('linked-fixture');localStorage.clear()`);
  await call('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  if (!process.argv.includes('--linked-tasks-only')) {
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tasks` });
  await waitFor(`document.querySelectorAll('article').length===3`);
  assert.equal(await evaluate(`document.querySelector('article').getAttribute('aria-label')`), 'First'); // Preserve server order on equal imported positions.
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[aria-label="Task board"]')).display`), 'flex');
  assert.equal(await evaluate(`document.querySelector('article[aria-label="Completed"] a img')!==null`),true);
  assert.equal(await evaluate(`document.querySelector('article[aria-label="Completed"] a').textContent`),'');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[aria-label="Task board"]')).scrollbarWidth`),'thin');
  // A plain card-body click opens all editable details, not just the title.
  const cardPoint=await evaluate(`(()=>{const r=document.querySelector('article[aria-label="First"]').getBoundingClientRect();return {x:r.x+2,y:r.y+2}})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...cardPoint,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...cardPoint,button:'left',clickCount:1});
  await waitFor(`document.querySelector('dialog')?.open`);
  assert.equal(await evaluate(`!!document.querySelector('dialog textarea')&&!!document.querySelector('dialog input[type=date]')`),true);
  await click('Cancel');
  await input('[aria-label="Inbox card title"]','Keep my draft');
  await click('Hide Inbox');
  assert.equal(await evaluate(`document.querySelector('#task-inbox').getBoundingClientRect().width`),0);
  await click('Show Inbox');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Inbox card title"]').value`),'Keep my draft');
  await input('[aria-label="Inbox card title"]','');
  await click('Hide Inbox'); await call('Page.reload');
  await waitFor(`document.querySelector('[aria-label="Board scope"]')&&document.querySelector('#task-inbox')?.getBoundingClientRect().width===0`);
  await click('Show Inbox');
  // Mouse sorting uses the same guarded endpoint and keeps controls separate.
  await drag('[aria-label="Drag First"]', '[aria-label="Drag Second"]');
  await waitFor(`window.moveRequests.length===1&&!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`document.querySelector('article').getAttribute('aria-label')`), 'Second');
  assert.deepEqual(await evaluate(`window.moveRequests[0]`), { key: 'manual:10', listId: 1, position: 'after', targetKey: 'manual:2', revision: 1 });
  assert.equal(await evaluate(`!!document.querySelector('dialog')`), false);
  await refreshBoard();
  assert.equal(await evaluate(`document.querySelector('article').getAttribute('aria-label')`), 'Second');
  await drag('[aria-label="Drag First"]', '[aria-labelledby="column-2"] > div',false,true);
  await waitFor(`window.fixture.tasks.find(t=>t.title==='First').listId===2&&!document.querySelector('[aria-busy=true]')`);
  await drag('[aria-label="Drag First"]', '[aria-label="Drag Completed"]');
  await waitFor(`window.fixture.tasks.find(t=>t.title==='First').listId===3&&!document.querySelector('[aria-busy=true]')`);
  const saved = await evaluate(`JSON.stringify(window.fixture.tasks)`), count = await evaluate(`window.moveRequests.length`);
  await drag('[aria-label="Drag First"]', '[aria-labelledby="column-2"] > div', true);
  assert.equal(await evaluate(`window.moveRequests.length`), count);
  assert.equal(await evaluate(`JSON.stringify(window.fixture.tasks)`), saved);
  await drag('[aria-label="Drag First"]', '[aria-label="Board scope"]');
  assert.equal(await evaluate(`window.moveRequests.length`), count); // Outside-board drops cancel.
  assert.equal(await evaluate(`JSON.stringify(window.fixture.tasks)`), saved);
  // Pending preview, rollback on server error, then revision-conflict recovery.
  await evaluate(`window.fixture.delayMove=true;window.fixture.failMove=500`);
  await drag('[aria-label="Drag First"]', '[aria-labelledby="column-2"] > div');
  await waitFor(`!!window.releaseMove`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby="column-2"] [aria-label="Drag First"]')`), true);
  await evaluate(`window.fixture.delayMove=false;window.releaseMove()`);
  await waitFor(`document.querySelector('[role=alert]')?.textContent.includes('Save failed')`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby="column-3"] [aria-label="Drag First"]')`), true);
  assert.equal(await evaluate(`JSON.stringify(window.fixture.tasks)`), saved);
  await refreshBoard();
  await evaluate(`window.fixture.failMove=409`);
  await drag('[aria-label="Drag First"]', '[aria-labelledby="column-2"] > div');
  await waitFor(`document.querySelector('[role=alert]')?.textContent.includes('Board changed')`);
  assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby="column-3"] [aria-label="Drag First"]')`), true);
  await refreshBoard();
  // Keyboard drag can be canceled; screen-reader instructions remain attached.
  await evaluate(`document.querySelector('[aria-label="Drag Second"]').focus()`);
  await key('Enter', 'Enter', 13); await waitFor(`document.querySelector('[data-dragging=true]')`);
  assert.equal(await evaluate(`document.body.textContent.includes('Escape cancels')`), true);
  await key('Escape', 'Escape', 27); await waitFor(`!document.querySelector('[data-dragging=true]')`);
  await waitFor(`!document.getAnimations().some(animation=>animation.playState==='running')`);
  const keyboardCount = await evaluate(`window.moveRequests.length`);
  await evaluate(`document.querySelector('[aria-label="Drag Second"]').focus()`);
  await key('Enter', 'Enter', 13); await waitFor(`document.querySelector('[data-dragging=true]')`);
  for (let step=0;step<3;step++) { await key('ArrowRight','ArrowRight',39); await pause(100); if(await evaluate(`!!document.querySelector('[aria-labelledby="column-2"] [aria-label="Drag Second"]')`)) break; }
  await key('Enter', 'Enter', 13);
  await waitFor(`window.moveRequests.length===${keyboardCount + 1}&&!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`window.fixture.tasks.find(t=>t.title==='Second').listId`), 2);
  await waitFor(`!document.getAnimations().some(animation=>animation.playState==='running')`);
  // Touch: a quick tap never moves a task; a deliberate hold then drag does.
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touchStart = await point('[aria-label="Drag First"]'), touchEnd = await point('[aria-labelledby="column-1"] > div');
  const touchCount = await evaluate(`window.moveRequests.length`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchStart, id: 1 }] });
  await pause(50); await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await evaluate(`window.moveRequests.length`), touchCount);
  await waitFor(`document.querySelector('dialog')?.open`);
  await click('Cancel'); await waitFor(`!document.querySelector('dialog')`);
  await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchStart, id: 1 }] });
  await pause(300); await waitFor(`document.querySelector('[data-dragging=true]')`);
  for (let step = 1; step <= 8; step++) { await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchStart.x + (touchEnd.x - touchStart.x) * step / 8, y: touchStart.y + (touchEnd.y - touchStart.y) * step / 8, id: 1 }] }); await pause(35); }
  await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitFor(`window.moveRequests.length===${touchCount + 1}&&!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`window.fixture.tasks.find(t=>t.title==='First').listId`), 1);
  await call('Emulation.setTouchEmulationEnabled', { enabled: false });
  // Personal quick-add, card editor, explicit publication and persisted placement.
  await call('Page.reload'); await waitFor(`window.fixture?.revision===1&&document.querySelectorAll('article').length===3`);
  await input('[aria-label="Inbox card title"]', 'Private follow up'); await click('Add card');
  await waitFor(`document.querySelector('[aria-labelledby="column-inbox"] article')`);
  assert.equal(await evaluate(`window.fixture.tasks.at(-1).listId`),null);
  await click('Private follow up'); await waitFor(`document.querySelector('dialog')?.open`);
  await input('dialog input[type=date]', '2026-09-22'); await input('dialog textarea','Notes');
  await click('Save task'); await waitFor(`!document.querySelector('dialog')`);
  await click('Private follow up'); await waitFor(`document.querySelector('dialog')?.open`);
  await input('[aria-label="Task list"]','2'); await click('Save task'); await waitFor(`!document.querySelector('dialog')`);
  await waitFor(`document.querySelector('[aria-labelledby="column-2"] article[aria-label="Private follow up"]')&&!document.querySelector('[aria-busy=true]')`);
  await refreshBoard();
  await click('Private follow up'); await waitFor(`document.querySelector('dialog')?.open`);
  await input('[aria-label="Task list"]','inbox'); await click('Save task'); await waitFor(`!document.querySelector('dialog')`);
  await waitFor(`document.querySelector('[aria-labelledby="column-inbox"] article')&&!document.querySelector('[aria-busy=true]')`);
  // Search and select multiple students; retain selections across searches and saves.
  await click('Private follow up'); await waitFor(`document.querySelector('dialog')?.open`);
  await evaluate(`document.querySelector('dialog details summary').click()`);
  await input('dialog input[type=search]', 'Test');
  await evaluate(`document.querySelector('[aria-label="Student choices"] input').click()`);
  await input('dialog input[type=search]', 'Another');
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Student choices"] img')`), true);
  await evaluate(`document.querySelector('[aria-label="Student choices"] input').click()`);
  await click('Save task'); await waitFor(`!document.querySelector('dialog')`);
  assert.equal(await evaluate(`document.querySelectorAll('article[aria-label="Private follow up"] a').length`),2);
  assert.equal(await evaluate(`(()=>{const c=document.querySelector('article[aria-label="Private follow up"]'), d=c.querySelector('time').getBoundingClientRect(), a=c.querySelector('a').getBoundingClientRect();return d.left>a.right&&Math.abs(d.bottom-a.bottom)<10})()`),true);
  await click('Private follow up'); await waitFor(`document.querySelector('dialog')?.open`);
  await evaluate(`document.querySelector('dialog details summary').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Student choices"] input:checked').length`),2);
  await evaluate(`document.querySelector('[aria-label="Student choices"] input').click()`);
  await click('Save task'); await waitFor(`!document.querySelector('dialog')`);
  assert.equal(await evaluate(`document.querySelectorAll('article[aria-label="Private follow up"] a').length`),1);
  // Drag directly from the private Inbox to a shared list and back.
  await drag('[aria-label="Drag Private follow up"]','[aria-labelledby="column-2"] > div');
  await waitFor(`window.fixture.tasks.at(-1).listId===2&&!document.querySelector('[aria-busy=true]')`);
  await drag('[aria-label="Drag Private follow up"]','[aria-labelledby="column-inbox"] h2');
  await waitFor(`window.fixture.tasks.at(-1).listId===null&&!document.querySelector('[aria-busy=true]')`);
  await input('[aria-label="Inbox card title"]','Second private'); await click('Add card');
  await waitFor(`document.querySelectorAll('[aria-labelledby="column-inbox"] article').length===2`);
  await click('Second private'); await waitFor(`document.querySelector('dialog')?.open`);
  await click('Move up'); await waitFor(`!document.querySelector('dialog button:disabled[aria-label="Close task editor"]')`);
  await evaluate(`document.querySelector('[aria-label="Close task editor"]').click()`);
  await waitFor(`document.querySelector('[aria-labelledby="column-inbox"] article')?.getAttribute('aria-label')==='Second private'&&!document.querySelector('[aria-busy=true]')`);
  assert.equal(await evaluate(`document.querySelectorAll('article details').length`),0);
  // List handles reorder whole panels; cards keep their list and order.
  const taskPlacements=await evaluate('window.fixture.tasks.map(task=>[task.key,task.listId,task.sortOrder])');
  await drag('[aria-label="Drag list This Week"]','[aria-label="Drag list Finished"]');
  await waitFor(`window.listMoves.length===1&&!document.querySelector('[aria-busy=true]')`);
  assert.deepEqual(await evaluate('window.fixture.tasks.map(task=>[task.key,task.listId,task.sortOrder])'),taskPlacements);
  const listOrderBeforeFailure=await evaluate('window.fixture.lists.map(list=>list.id)');
  await evaluate('window.fixture.failLayout=true');
  await drag('[aria-label="Drag list This Week"]','[aria-label="Drag list Planning"]');
  await waitFor(`document.querySelector('[role=alert]')`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[aria-label="Task board"] > section')].map(e=>Number(e.getAttribute('aria-labelledby').slice(7)))`),listOrderBeforeFailure);
  await refreshBoard();
  await evaluate(`document.querySelector('[aria-label="Planning list settings"]').click()`);
  assert.equal(await evaluate(`document.body.textContent.includes('Move left')||document.body.textContent.includes('Move right')`),false);
  await click('Remove list'); await click('Remove list');
  await waitFor(`!window.fixture.lists.some(list=>list.title==='Planning')&&!document.querySelector('[aria-busy=true]')`);
  // Keyboard list sorting uses the header; Escape cancels without persistence.
  const listMovesBeforeKeyboard=await evaluate('window.listMoves.length');
  await evaluate(`document.querySelector('[aria-label="Drag list This Week"]').focus()`);
  await key(' ', 'Space', 32); await waitFor(`document.querySelector('section[data-dragging=true]')`); await pause(150);
  await key('ArrowLeft','ArrowLeft',37); await pause(150); await key(' ', 'Space', 32);
  await waitFor(`window.listMoves.length===${listMovesBeforeKeyboard+1}&&!document.querySelector('[aria-busy=true]')`); await pause(400);
  await evaluate(`document.querySelector('[aria-label="Drag list This Week"]').focus()`);
  await key(' ', 'Space', 32); await waitFor(`document.querySelector('section[data-dragging=true]')`); await pause(150);
  await key('ArrowRight','ArrowRight',39); await key('Escape','Escape',27); await pause(400);
  assert.equal(await evaluate('window.listMoves.length'),listMovesBeforeKeyboard+1);
  const listMovesBeforeTouch=await evaluate('window.listMoves.length');
  await call('Emulation.setTouchEmulationEnabled',{enabled:true});
  const listTouchStart=await point('[aria-label="Drag list This Week"]'), listTouchEnd=await point('[aria-label="Drag list Finished"]');
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...listTouchStart,id:1}]});
  await pause(300);
  await waitFor(`document.querySelector('section[data-dragging=true]')`); await pause(150);
  for(let step=1;step<=6;step++){await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:listTouchStart.x+(listTouchEnd.x-listTouchStart.x)*step/6,y:listTouchStart.y,id:1}]});await pause(40);}
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor(`window.listMoves.length===${listMovesBeforeTouch+1}&&!document.querySelector('[aria-busy=true]')`);
  await pause(400); await call('Emulation.setTouchEmulationEnabled',{enabled:false});
  const paint=async(label,color)=>{
    if(label==='School board'||label==='Personal board') await evaluate(`document.querySelector('[aria-label="Change color"]').click()`);
    else {
      await evaluate(`document.querySelector('[aria-label="${label} settings"]').click()`);
      await evaluate(` [...document.querySelectorAll(':popover-open button')].find(button=>button.textContent.trim()==='Change color').click()`);
    }
    await evaluate(`document.querySelector(':popover-open [aria-label="${color}"]').click()`);
    await waitFor(`!document.querySelector(':popover-open')&&!document.querySelector('[aria-busy=true]')`);
  };
  await paint('School board','Ocean'); await paint('Inbox','Plum'); await paint('This Week list','Gold');
  assert.equal(await evaluate(`window.fixture.boards[0].color`),'ocean');
  assert.equal(await evaluate(`window.fixture.inboxColor`),'plum');
  await refreshBoard();
  assert.equal(await evaluate(`document.querySelector('[aria-labelledby="column-1"]').style.background`),'rgb(206, 144, 50)');
  // The reference geometry: tall Inbox, aligned shared header, horizontal lists.
  assert.equal(await evaluate(`(()=>{const inbox=document.querySelector('[aria-labelledby="column-inbox"]').getBoundingClientRect(), shared=document.querySelector('[aria-label="School board"]').getBoundingClientRect();return Math.abs(inbox.top-shared.top)<2&&shared.left>inbox.right&&inbox.height>800})()`),true);
  if (process.env.TASK_UI_SCREENSHOTS) { const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(process.env.TASK_UI_SCREENSHOTS,'tasks-desktop.png'),Buffer.from(shot.data,'base64')); }
  assert.equal(await evaluate(`!document.querySelector('[aria-controls="task-filters"]')&&!document.querySelector('[aria-label="Task filters"]')`),true);
  await input('[aria-label="Inbox card title"]','Unsent private draft');
  await click('Personal');
  await waitFor(`document.querySelector('[aria-label="Personal board"]')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Inbox card title"]').value`),'Unsent private draft');
  await paint('Personal board','Lilac');
  assert.equal(await evaluate(`window.fixture.boards.find(board=>board.scope==='school').color`),'ocean');
  await input('[aria-label="Inbox card title"]','');
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="Task board"] article').length`),0);
  assert.equal(await evaluate(`document.querySelectorAll('[aria-labelledby="column-inbox"] article').length`),2);
  await click('+ Add another list'); await input('[aria-label="Create list"] input','Invitations'); await click('Add list');
  await waitFor(`window.fixture.lists.some(list=>list.title==='Invitations')&&!document.querySelector('[aria-busy=true]')`);
  await input('[aria-label="Create list"] input','Venue'); await click('Add list');
  await waitFor(`document.querySelectorAll('[aria-label="Task board"] > section').length===2&&!document.querySelector('[aria-busy=true]')`);
  await evaluate(`document.querySelector('[aria-label="Cancel adding list"]').click()`);
  await click('+ Add a card'); await input('[aria-label="Card title"]','Invite teachers'); await click('Add card');
  await waitFor(`document.querySelector('[aria-label="Task board"] article')`);
  assert.equal(await evaluate(`window.fixture.tasks.at(-1).listId===window.fixture.lists.find(list=>list.title==='Invitations').id`),true);
  await call('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=320`),true);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Task workspace"]').scrollWidth>320`),true);
  await evaluate(`document.querySelector('[aria-label="Inbox settings"]').click()`);
  await click('Change color');
  assert.equal(await evaluate(`(()=>{const r=document.querySelector(':popover-open').getBoundingClientRect();return r.left>=0&&r.right<=320&&r.top>=0&&r.bottom<=740})()`),true);
  await evaluate(`document.querySelector(':popover-open [aria-label="Default"]').click()`);
  await waitFor(`!document.querySelector(':popover-open')&&!document.querySelector('[aria-busy=true]')`);
  await evaluate(`document.querySelector('[aria-label="Task workspace"]').scrollLeft=0`);
  await call('Emulation.setTouchEmulationEnabled',{enabled:true});
  const swipeStart=await point('[aria-labelledby="column-inbox"] h2'), movesBeforeSwipe=await evaluate('window.moveRequests.length');
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...swipeStart,id:1}]});
  for(let step=1;step<=4;step++){await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:swipeStart.x-step*25,y:swipeStart.y,id:1}]});await pause(20);}
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await waitFor(`document.querySelector('[aria-label="Task workspace"]').scrollLeft>0`);
  assert.equal(await evaluate('window.moveRequests.length'),movesBeforeSwipe,'Swiping the list background should scroll, not drag.');
  await pause(400); await call('Emulation.setTouchEmulationEnabled',{enabled:false});
  await evaluate(`document.querySelector('[aria-label="Task workspace"]').scrollLeft=0`);
  await click('Second private'); await waitFor(`document.querySelector('dialog')?.open`);
  assert.equal(await evaluate(`document.querySelector('dialog').scrollWidth<=320`),true);
  await click('Delete task'); await click('Confirm delete'); await waitFor(`!document.querySelector('dialog')`);
  assert.equal(await evaluate(`window.fixture.tasks.some(t=>t.title==='Second private')`),false);
  if(process.env.TASK_UI_SCREENSHOTS){const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(resolve(process.env.TASK_UI_SCREENSHOTS,'tasks-mobile.png'),Buffer.from(shot.data,'base64'));}
  await evaluate(`window.fixture.loseCreate=true`);
  await input('[aria-label="Inbox card title"]','Lost-response draft'); await click('Add card');
  await waitFor(`document.querySelector('[aria-label="Add Inbox card"] [role=alert]')`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Inbox card title"]').disabled`),true);
  await click('Retry'); await waitFor(`document.querySelector('article[aria-label="Lost-response draft"]')`);
  assert.equal(await evaluate(`window.fixture.tasks.filter(t=>t.title==='Lost-response draft').length`),1);
  assert.deepEqual(exceptions,[]);
  console.log('PASS: desktop/mobile reference layout, Inbox/list creation, private/shared moves, mouse/touch/keyboard drag, rollback, compact cards/editor/delete, explicit ordering, School/Personal boards and lists, and header controls.');
  }
  await call('Browser.close');
} finally {
  clearTimeout(timeout); socket?.close(); chrome?.kill(); server?.close();
  await new Promise(resolve => setTimeout(resolve, 100));
  await rm(directory, { recursive: true, force: true });
}
