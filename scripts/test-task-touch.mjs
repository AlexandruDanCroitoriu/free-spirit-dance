import assert from 'node:assert/strict';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = process.env.TASK_UI_CHROME;
if (!binary) throw new Error('Set TASK_UI_CHROME to a Chromium executable.');
const bundle = await build({ stdin: { resolveDir: resolve('.'), loader: 'tsx', contents: `


 import React from 'react';import {createRoot} from 'react-dom/client';
 import TaskDragBoard from './app/components/task-drag-board';
 const tasks=Array.from({length:30},(_,i)=>({key:'manual:'+i,title:'Card '+i,status:'in_progress',source:'manual',category:'manual',listId:1,description:'',dueDate:null,students:[],courses:[],sortOrder:i,canDelete:true,createdBy:'',createdAt:'',updatedBy:'',updatedAt:''}));
 const columns=Array.from({length:3},(_,i)=>({id:i+1,boardId:1,title:'List '+i,sortOrder:i,color:'default'}));
 window.edits=0;window.starts=0;window.fetch=async()=>Response.json([]);
 createRoot(document.querySelector('#editor')).render(<TaskDragBoard board={{tasks,lists:columns,boards:[{id:1,scope:'school',color:'default'}],inboxColor:'default',revision:1}} columns={columns} visible={tasks} today="2026-09-16" disabled={false} onDragging={v=>{if(v)window.starts++}} onStudent={()=>{}} onMove={async()=>{}} onEdit={()=>window.edits++} onCreate={async()=>{}} onAddList={async()=>{}} onColor={async()=>{}} onListMove={async()=>{}} onRemoveList={async()=>{}}/>);
` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic' });
const css = (await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), {from:resolve('app/globals.css')})).css;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  if (request.url === '/fixture.js') { response.setHeader('Content-Type','text/javascript'); response.end(bundle.outputFiles[0].text); }
  else if (request.url.startsWith('/api/tasks/images/')) { response.setHeader('Content-Type','image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="blue"/></svg>'); }
  else response.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css} body{margin:0}</style><div id="editor"></div><script src="/fixture.js"></script>`);
});
const directory = await mkdtemp(join(tmpdir(), 'fsd-image-resize-'));
let chrome, socket;
const timeout = setTimeout(() => { chrome?.kill(); process.exit(1); }, 30000);
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  chrome = spawn(binary, ['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-port=0',`--user-data-dir=${directory}`,'about:blank'], {stdio:['ignore','ignore','pipe']});
  const endpoint = await new Promise((resolve,reject) => { let log=''; chrome.stderr.on('data',data=>{log+=data;const match=log.match(/DevTools listening on (ws:\/\/\S+)/);if(match)resolve(match[1]);});chrome.on('error',reject);chrome.on('exit',()=>reject(Error(log))); });
  const targets = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json();
  socket = new WebSocket(targets.find(item=>item.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
  let sequence=0; const pending=new Map();
  socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);pending.delete(data.id);data.error?p.reject(data.error):p.resolve(data.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(message.params)); });
  await call('Runtime.enable');
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};


 await call('Emulation.setDeviceMetricsOverride',{width:Number(process.env.TOUCH_TEST_WIDTH ?? 390),height:844,deviceScaleFactor:1,mobile:true});
 await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 for(let i=0;i<100;i++){if(await evaluate('!!document.querySelector("[data-task-open]")'))break;await pause(30);}
 const point=()=>evaluate('(()=>{const r=document.querySelector("[data-task-open]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
 const touch=(type,p)=>call('Input.dispatchTouchEvent',{type,touchPoints:p?[{...p,id:1}]:[]});
 let p=await point();
 await touch('touchStart',p);await pause(50);await touch('touchEnd');await pause(200);
 assert.equal(await evaluate('edits'),1,'tap opens card');
 assert.equal(await evaluate('starts'),0,'tap does not drag');
 p=await point();
 await touch('touchStart',p);
 for(let i=1;i<=6;i++){await pause(20);await touch('touchMove',{x:p.x,y:p.y-i*10});}
 await touch('touchEnd');await pause(1200);
 assert.equal(await evaluate('starts'),0,'swipe does not drag');
 const scroll=await evaluate('document.querySelector("article").closest(".overflow-y-auto").scrollTop');
 assert.ok(scroll>0,'swipe scrolls vertically: '+scroll);
 await evaluate('document.querySelector("article").closest(".overflow-y-auto").scrollTop=0');await pause(500);
 await pause(150);p=await point();await touch('touchStart',p);
 for(let i=1;i<=8;i++){await pause(20);await touch('touchMove',{x:p.x-i*15,y:p.y});}
 await touch('touchEnd');await pause(350);
 const horizontal=await evaluate(`document.querySelector('[aria-label="Task board"]').scrollLeft`);
 assert.ok(horizontal>0,'swiping left from a card scrolls the board: '+horizontal);
 assert.equal(await evaluate('starts'),0,'horizontal swipe does not drag');
 await evaluate(`document.querySelector('[aria-label="Task board"]').scrollLeft=0`);await pause(350);
 p=await point();await touch('touchStart',p);await pause(500);
 assert.equal(await evaluate('starts'),1,'hold activates dragging');
 await touch('touchMove',{x:p.x,y:p.y+50});await touch('touchEnd');await pause(500);
 assert.equal(await evaluate('edits'),1,'drag must not open card');
 await evaluate(`document.querySelector('[aria-label="Task board"]').scrollLeft=0`);await pause(500);
 // Start near the right edge of the title so the swipe stays on screen.
 p=await evaluate(`(()=>{const r=document.querySelector('[data-list-handle] h2').getBoundingClientRect();return {x:r.right-2,y:r.y+r.height/2}})()`);
 await touch('touchStart',p);
 for(let i=1;i<=6;i++){await pause(20);await touch('touchMove',{x:p.x-i*8,y:p.y});}
 await touch('touchEnd');await pause(350);
 assert.ok(await evaluate(`document.querySelector('[aria-label="Task board"]').scrollLeft>0`),'swiping on list title scrolls horizontally');
 assert.equal(await evaluate('starts'),1,'title swipe does not start list drag');
 await evaluate(`document.querySelector('[aria-label="Task board"]').scrollLeft=0`);await pause(500);
 // Hold the header's left padding, outside the title and action buttons.
 p=await evaluate(`(()=>{const r=document.querySelector('[data-list-handle]').getBoundingClientRect();return {x:r.x+5,y:r.y+r.height/2}})()`);
 await touch('touchStart',p);await pause(500);
 assert.equal(await evaluate('starts'),2,'holding header padding starts list drag');
 await touch('touchMove',{x:p.x+60,y:p.y});await touch('touchEnd');await pause(500);
 for (const [index, selector] of ['[data-list-handle] button:not([popovertarget])', '[data-list-handle] button[popovertarget]'].entries()) {
   p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await touch('touchStart',p);await pause(500);
   assert.equal(await evaluate('starts'),3+index,'holding a header button starts list drag');
   await touch('touchMove',{x:p.x+20,y:p.y+10});await touch('touchEnd');await pause(600);
   assert.equal(await evaluate(`!!document.querySelector('input[aria-label="Card title"]')`),false,'long press does not open composer');
   assert.equal(await evaluate(`!!document.querySelector('[popover]:popover-open')`),false,'long press does not open settings');
 }
 p=await evaluate(`(()=>{const r=document.querySelector('[data-list-handle] button[popovertarget]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await touch('touchStart',p);await pause(50);await touch('touchEnd');await pause(150);
 assert.ok(await evaluate(`!!document.querySelector('[popover]:popover-open')`),'settings still opens on tap');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 p=await evaluate(`(()=>{const r=document.querySelector('[data-list-handle] button:not([popovertarget])').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await touch('touchStart',p);await pause(50);await touch('touchEnd');await pause(100);
 assert.ok(await evaluate(`!!document.querySelector('input[aria-label="Card title"]')`),'Add card still opens on tap');
 assert.equal(await evaluate('starts'),4,'normal button taps do not drag');
 console.log('PASS: touch taps open cards, vertical and horizontal swipes scroll, and only a hold activates dragging.');

} finally {
  clearTimeout(timeout);socket?.close();
  if(chrome && chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await exited;}
  await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});
}
