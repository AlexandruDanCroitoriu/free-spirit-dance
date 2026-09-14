import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const temp = await mkdtemp(join(tmpdir(),'fsd-local-backups-'));
const previousFetch = globalThis.fetch;
try {
  const output = join(temp,'test.mjs');
  await build({stdin:{contents:`export * from './app/lib/production-backups/local'; export * from './app/lib/production-backups/development'; export * from './app/lib/production-backups/bridge';`,resolveDir:process.cwd()},outfile:output,bundle:true,format:'esm',platform:'node',plugins:[{name:'runtime',setup(build){
    build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'mock'}));
    build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env; } }'}));
    build.onResolve({filter:/(?:^|\/)storage$/},()=>({path:'storage',namespace:'storage'}));
    build.onLoad({filter:/.*/,namespace:'storage'},()=>({contents:'export const env={}; export const withStorage=(env,callback)=>callback();'}));
  }}]});
  const {LocalBackupCoordinator,localBackupManagement,localBackupRequest,allowedDevelopmentOrigin,connectProductionBackups,PRODUCTION_ORIGIN,BRIDGE_CHANNEL}=await import(pathToFileURL(output));
  globalThis.fetch=async()=>{throw new Error('Local backups must never use the network');};
  async function database() {
    const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
    for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(await readFile('migrations/'+name,'utf8'));
    function prepare(sql,params=[]) {return {sql,params,bind(...values){return prepare(sql,values);},async run(){const r=sqlite.prepare(sql).run(...params);return {success:true,meta:{changes:Number(r.changes)},results:[]};},async all(){return {success:true,results:sqlite.prepare(sql).all(...params)};},async first(){return sqlite.prepare(sql).get(...params)??null;}};}
    return {sqlite,prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>{const q=sqlite.prepare(s.sql);return {success:true,results:q.columns().length?q.all(...s.params):(q.run(...s.params),[])};});sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  }
  class Bucket {
    items=new Map();
    async put(key,body,meta={}){const bytes=Buffer.from(await new Response(body).arrayBuffer());const etag=createHash('md5').update(bytes).digest('hex');this.items.set(key,{bytes,etag,...meta});return {size:bytes.length,etag};}
    async get(key){const v=this.items.get(key);return v?{body:new Response(v.bytes).body,etag:v.etag,httpMetadata:v.httpMetadata,json:async()=>JSON.parse(v.bytes.toString())}:null;}
    async list({prefix='',cursor,limit=1000}={}){const keys=[...this.items.keys()].filter(k=>k.startsWith(prefix)).sort();const start=Number(cursor??0);return {objects:keys.slice(start,start+limit).map(key=>({key})),truncated:start+limit<keys.length,cursor:String(start+limit)};}
    async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])this.items.delete(key);}
  }
  const catalog=await database(),working=await database(),second=await database();
  catalog.sqlite.exec("INSERT INTO students (first_name,last_name,email,picture) VALUES ('Local','Student','','/api/student-images/student-local'); CREATE TABLE history_absences (student_id TEXT,course_id TEXT,class_date TEXT,start_time TEXT); INSERT INTO history_absences VALUES ('1','1','2026-09-01','19:00');");
  const images=new Bucket(),bucket=new Bucket();await images.put('student-local','original-photo');
  const env={LOCAL_STORAGE_ENABLED:'true',CATALOG_DB:catalog,CATALOG_IMAGES:images,WORKING_DB:working,WORKING_IMAGES:new Bucket(),COPY2_DB:second,COPY2_IMAGES:new Bucket(),LOCAL_BACKUP_BUCKET:bucket};
  for(const key of ['DB','STUDENT_IMAGES','PRODUCTION_DB','PRODUCTION_IMAGES','BACKUP_API_TOKEN'])Object.defineProperty(env,key,{get(){throw new Error(`Unexpected production access: ${key}`);}});
  const sql=new DatabaseSync(':memory:');let alarm=null;
  const ctx={storage:{sql:{exec(query,...values){const q=sql.prepare(query);const rows=q.columns().length?q.all(...values):(q.run(...values),[]);return {toArray:()=>rows,one:()=>rows[0]};}},transactionSync(fn){sql.exec('BEGIN');try{const v=fn();sql.exec('COMMIT');return v;}catch(e){sql.exec('ROLLBACK');throw e;}},async getAlarm(){return alarm;},async setAlarm(value){alarm=value;}}};
  const c=new LocalBackupCoordinator(ctx,env);env.LOCAL_BACKUPS={getByName:()=>c};
  await c.ensureAlarm();assert.ok(alarm>Date.now());
  const backup=c.reserve('backup','','Local test','owner');await c.runLocalJob(backup);
  assert.equal(c.backup(backup.backupId).status,'ready');assert.equal(c.backup(backup.backupId).photos,1);
  await c.runLocalJob(c.reserve('activate',backup.backupId,'','owner',1));
  assert.equal(c.status().active,backup.backupId);
  assert.equal(working.sqlite.prepare('SELECT first_name FROM students').get().first_name,'Local');
  assert.equal(working.sqlite.prepare('SELECT ready FROM local_database_copies').get().ready,3);
  assert.equal(working.sqlite.prepare('SELECT COUNT(*) AS n FROM history_absences').get().n,1);
  working.sqlite.exec("UPDATE students SET first_name='Edited'");
  await env.WORKING_IMAGES.put('student-local','edited-photo');
  await c.runLocalJob(c.reserve('return','','','owner',2));
  await c.runLocalJob(c.reserve('activate',backup.backupId,'','owner',3));
  assert.equal(working.sqlite.prepare('SELECT first_name FROM students').get().first_name,'Edited');
  assert.equal(catalog.sqlite.prepare('SELECT first_name FROM students').get().first_name,'Local');
  assert.equal(images.items.get('student-local').bytes.toString(),'original-photo');
  assert.equal(bucket.items.get(`snapshots/${backup.backupId}/images/student-local`).bytes.toString(),'original-photo');
  const generation=c.status().generation;
  const save=new Request('http://localhost:3000/api/students',{method:'POST',headers:{Origin:'http://localhost:3000','X-FSD-Generation':'1'}});
  assert.equal((await localBackupRequest(save,env,'backup-test',async()=>{throw Error('Stale request reached storage');})).status,409);
  const request=(input,origin='http://localhost:3000',email='croitoriu.alexandru.code@gmail.com')=>new Request('http://localhost:3000/api/administrators/local-backups',{method:input?'POST':'GET',headers:{Origin:origin,'cf-access-authenticated-user-email':email,'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});
  assert.equal((await localBackupManagement(request({action:'backup'},'https://evil.test'),env,{waitUntil(){}})).status,403);
  assert.equal((await localBackupManagement(request(null,undefined,'someone@example.test'),env,{waitUntil(){}})).status,403);
  assert.equal((await localBackupManagement(request(null),{LOCAL_STORAGE_ENABLED:'false'},{waitUntil(){}})).status,404);
  assert.equal((await localBackupManagement(request(null),env,{waitUntil(){}})).status,200);
  assert.throws(()=>c.reserve('delete',backup.backupId,'','owner'));
  await c.runLocalJob(c.reserve('return','','','owner',generation));
  await c.runLocalJob(c.reserve('delete',backup.backupId,'','owner'));
  assert.equal(c.status().backups.length,0);assert.equal(bucket.items.size,0);
  assert.equal(working.sqlite.prepare('SELECT COUNT(*) AS n FROM local_database_copies').get().n,0);
  assert.equal(working.sqlite.prepare('SELECT COUNT(*) AS n FROM students').get().n,0);
  c.schedule({enabled:false,weekday:6,time:'04:00',once:null});await c.alarm();assert.ok(alarm>Date.now());
  assert.equal(c.status().job,null);

  assert.ok(allowedDevelopmentOrigin('http://localhost:3000'));assert.ok(allowedDevelopmentOrigin('https://dev-free-spirit-dance.alexandru-croitoriu.dev'));
  assert.ok(!allowedDevelopmentOrigin('https://evil.test'));assert.ok(!allowedDevelopmentOrigin('http://localhost.evil.test:3000'));assert.ok(!allowedDevelopmentOrigin('http://localhost:4000'));
  const listeners=new Set();let opened, sent;
  const popup={closed:false,postMessage(message,target){sent={message,target};},close(){this.closed=true;}};
  globalThis.window={location:{origin:'http://localhost:3000'},open(url){opened=url;return popup;},addEventListener(name,fn){listeners.add(fn);},removeEventListener(name,fn){listeners.delete(fn);}};
  const connection=connectProductionBackups();assert.equal(new URL(opened).origin,PRODUCTION_ORIGIN);
  const pending=connection.request({action:'backup'});assert.equal(sent.target,PRODUCTION_ORIGIN);
  const event={origin:PRODUCTION_ORIGIN,source:popup,data:{channel:BRIDGE_CHANNEL,nonce:sent.message.nonce,id:sent.message.id,status:202,body:'{"accepted":true}'}};
  for(const receive of listeners)receive({...event,origin:'https://evil.test'});
  for(const receive of listeners)receive({...event,source:{}});
  for(const receive of listeners)receive(event);
  assert.equal((await pending).status,202);
  connection.close();assert.equal(listeners.size,0);assert.ok(popup.closed);
  delete globalThis.window;
  console.log('PASS: isolated local Catalog/photo backup, reserved slot restore/edit/reactivate/delete, historical absences, stale writes, owner/origin guards, local alarm, and production bridge origin/source/nonce checks.');
} finally {globalThis.fetch=previousFetch;await rm(temp,{recursive:true,force:true});}
