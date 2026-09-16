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

  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import TaskSettings from './app/components/task-settings';
  createRoot(document.querySelector('#editor')).render(<div style={{position:'fixed',right:12,bottom:80}}>
    <TaskSettings label="Inbox" disabled={false} onColor={async()=>{}} />
  </div>);
` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic' });
const css = (await postcss([tailwind()]).process(await readFile('app/globals.css', 'utf8'), {from:resolve('app/globals.css')})).css;
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') { response.setHeader('Content-Type','text/javascript'); response.end(bundle.outputFiles[0].text); }
  else if (request.url.startsWith('/api/tasks/images/')) { response.setHeader('Content-Type','image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="blue"/></svg>'); }
  else response.end(`<style>${css} #editor{width:600px;margin:40px}</style><div id="editor"></div><script src="/fixture.js"></script>`);
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
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};

  await call('Emulation.setDeviceMetricsOverride',{width:375,height:740,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  const waitFor=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error(expression);};
  await waitFor('!!document.querySelector("button")');
  await evaluate('document.querySelector("button").click()');
  await waitFor('document.querySelector("[popover]").matches(":popover-open") && getComputedStyle(document.querySelector("[popover]")).visibility === "visible"');
  const bounds=()=>evaluate('(()=>{const r=document.querySelector("[popover]").getBoundingClientRect(),a=document.querySelector("button").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,anchorTop:a.top,anchorBottom:a.bottom}})()');
  let rect=await bounds();
  assert.ok(rect.left>=12 && rect.right<=363,JSON.stringify(rect));
  assert.ok(rect.top>=rect.anchorBottom+7 || rect.bottom<=rect.anchorTop-7,'Menu should anchor next to its trigger');
  assert.equal(await evaluate('!!document.querySelector("[popover] strong")'),false,'No dropdown header');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Change color")).click()');
  await new Promise(resolve=>setTimeout(resolve,100));
  rect=await bounds();
  assert.ok(rect.top>=12 && rect.bottom<=728 && rect.right<=363,JSON.stringify(rect));
  await call('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:false});
  await new Promise(resolve=>setTimeout(resolve,100));
  rect=await bounds();
  assert.ok(rect.left>=12 && rect.right<=308 && rect.top>=12 && rect.bottom<=556,JSON.stringify(rect));
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await evaluate('document.querySelector("[popover]").matches(":popover-open")'),false);
  console.log('PASS: Inbox settings stays within mobile viewport, anchors above the trigger, and repositions for colors and viewport changes.');

} finally {
  clearTimeout(timeout);socket?.close();
  if(chrome && chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await exited;}
  await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});
}
