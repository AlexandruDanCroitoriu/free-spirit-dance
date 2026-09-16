import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = process.env.TASK_UI_CHROME;
if (!binary) throw new Error('Set TASK_UI_CHROME to a Chromium executable.');
const bundle = await build({ stdin: { resolveDir: resolve('.'), loader: 'tsx', contents: `
  import { Editor } from '@tiptap/react';
  import StarterKit from '@tiptap/starter-kit';
  import { TaskImage } from './app/components/task-student-mention';
  import { descriptionDocument, serializeDescription } from './app/lib/task-description';
  window.editor = new Editor({element:document.querySelector('#editor'), extensions:[StarterKit, TaskImage],
    editorProps:{attributes:{class:'task-rich-text'}}, content:{type:'doc',content:[{type:'taskImage',attrs:{id:'12345678-1234-1234-1234-123456789abc',width:75}},{type:'paragraph',content:[{type:'text',text:'After image'}]}]}});
  window.reloadDescription = () => editor.commands.setContent(descriptionDocument(serializeDescription(editor.getJSON(), false)));
` }, bundle: true, write: false, platform: 'browser', format: 'iife' });
const css = (await readFile('app/globals.css', 'utf8')).replace('@import "tailwindcss";', '');
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
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
  for(let i=0;i<100;i++){if(await evaluate('!!window.editor?.commands && document.querySelector("img")?.naturalWidth > 0'))break;await new Promise(resolve=>setTimeout(resolve,30));}
  const point=await evaluate('(()=>{const r=document.querySelector(".task-image-resize").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x-150,y:point.y-75,buttons:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x-150,y:point.y-75,button:'left',clickCount:1});
  assert.equal(await evaluate('editor.getJSON().content[0].attrs.width'),50,'drag commits width');
  assert.equal(await evaluate('document.querySelector(".task-image-frame").getBoundingClientRect().width'),300);
  assert.equal(await evaluate('document.querySelector("img").getBoundingClientRect().height'),150,'preserves aspect ratio');
  await evaluate('editor.commands.undo()');
  assert.equal(await evaluate('editor.getJSON().content[0].attrs.width'),75,'one undo restores width');
  await evaluate('editor.commands.redo(); reloadDescription()');
  assert.equal(await evaluate('editor.getJSON().content[0].attrs.width'),50,'saved size survives reloading');
  await evaluate('document.querySelector(".task-image-resize").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
  assert.equal(await evaluate('editor.getJSON().content[0].attrs.width'),51,'arbitrary widths work');
  await evaluate('reloadDescription();editor.setEditable(false)');
  assert.equal(await evaluate('editor.getJSON().content[0].attrs.width'),51);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".task-image-resize")).display'),'none','read-only images have no controls');
  console.log('PASS: corner drag resizes proportionally, undo/redo, saved arbitrary widths and read-only rendering.');
} finally {
  clearTimeout(timeout);socket?.close();
  if(chrome && chrome.exitCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill();await exited;}
  await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});
}
