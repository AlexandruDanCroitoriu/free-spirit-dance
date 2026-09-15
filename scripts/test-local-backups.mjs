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
  const workerSource = await readFile('worker.ts', 'utf8');
  const selectorSource = await readFile('app/components/development-storage.tsx', 'utf8');
  assert.doesNotMatch(workerSource, /backup-test|localBackupRequest|localBackupManagement|env\.LOCAL_BACKUPS/);
  assert.doesNotMatch(selectorSource, /backup-test|Backup test workspace|<option value="production">/);
  assert.match(selectorSource, /<option value="catalog">Catalog/);
  assert.match(selectorSource, /copies\.map/);
  assert.match(workerSource, /local-backups'\) return new Response\(null, \{ status: 404 \}\)/);
  const output = join(temp,'test.mjs');
  await build({stdin:{contents:`export * from './app/lib/production-backups/local'; export * from './app/lib/production-backups/development'; export * from './app/lib/production-backups/local-download'; export { schemaFingerprint } from './app/lib/production-backups/workflow';`,resolveDir:process.cwd()},outfile:output,bundle:true,format:'esm',platform:'node',plugins:[{name:'runtime',setup(build){
    build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'mock'}));
    build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env; } } export class WorkflowEntrypoint {}'}));
    build.onResolve({filter:/(?:^|\/)storage$/},()=>({path:'storage',namespace:'storage'}));
    build.onLoad({filter:/.*/,namespace:'storage'},()=>({contents:'export const env={}; export const withStorage=(env,callback)=>callback();'}));
  }}]});
  const {localProductionBackupManagement,saveBackupLocally,schemaFingerprint}=await import(pathToFileURL(output));
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
  const images=new Bucket();await images.put('student-local','original-photo');
  const env={LOCAL_STORAGE_ENABLED:'true',CATALOG_DB:catalog,CATALOG_IMAGES:images,WORKING_DB:working,WORKING_IMAGES:new Bucket(),COPY2_DB:second,COPY2_IMAGES:new Bucket()};
  for(const key of ['DB','STUDENT_IMAGES','PRODUCTION_DB','PRODUCTION_IMAGES','BACKUP_API_TOKEN'])Object.defineProperty(env,key,{get(){throw new Error(`Unexpected production access: ${key}`);}});

  const productionCardRequest=new Request('http://localhost:3000/api/development-production-backups',{headers:{'cf-access-authenticated-user-email':'croitoriu.alexandru.code@gmail.com'}});
  const productionCard=await localProductionBackupManagement(productionCardRequest,env);
  assert.equal(productionCard.status,200);assert.equal((await productionCard.json()).available,false);
  const snapshotId = crypto.randomUUID();
  const definitions = catalog.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const value = v => v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + v.replaceAll("'", "''") + "'";
  let snapshotSql = definitions.map(row => row.sql + ';').join('\n');
  for (const {name} of definitions) for (const row of catalog.sqlite.prepare(`SELECT * FROM "${name}"`).all()) snapshotSql += `\nINSERT INTO "${name}" VALUES (${Object.values(row).map(value).join(',')});`;
  snapshotSql += '\n' + catalog.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type IN ('trigger','view','index') AND sql IS NOT NULL").all().map(row => row.sql + ';').join('\n');
  const snapshotSchema = await schemaFingerprint(catalog);
  let failImage = false;
  const fetchSnapshot = async params => {
    assert.equal(params.id, snapshotId);
    if (params.download === 'metadata') return Response.json({name:'Production safety snapshot',schema:snapshotSchema,photos:1});
    if (params.download === 'sql') return new Response(snapshotSql);
    if (params.download === 'images') return Response.json({keys:['student-local'],cursor:''});
    assert.equal(params.download, 'image');
    if (failImage) throw new Error('Image missing');
    return new Response('snapshot-photo', {headers:{'Content-Type':'image/jpeg'}});
  };
  const saved = await saveBackupLocally(env, snapshotId, fetchSnapshot);
  assert.equal(saved.id, 'working');
  assert.equal(saved.copies.length, 1);
  assert.equal(working.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Local');
  assert.equal(working.sqlite.prepare('SELECT COUNT(*) AS n FROM history_absences').get().n, 1);
  assert.equal(env.WORKING_IMAGES.items.get('student-local').bytes.toString(), 'snapshot-photo');
  assert.equal(images.items.get('student-local').bytes.toString(), 'original-photo');
  failImage = true;
  await assert.rejects(saveBackupLocally(env, snapshotId, fetchSnapshot), /Image missing/);
  assert.equal(working.sqlite.prepare('SELECT COUNT(*) AS n FROM local_database_copies').get().n, 1, 'Failed copies do not consume a slot');
  assert.equal(working.sqlite.prepare('SELECT first_name FROM students').get().first_name, 'Local');
  failImage = false;
  const secondSaved = await saveBackupLocally(env, snapshotId, fetchSnapshot);
  assert.equal(secondSaved.id, 'copy2');
  await assert.rejects(saveBackupLocally(env, snapshotId, fetchSnapshot), /slots are in use/);
  await assert.rejects(saveBackupLocally({...env, LOCAL_STORAGE_ENABLED:'false'},snapshotId,fetchSnapshot), /unavailable/);
  console.log('PASS: saved backup download into local copies, photos, historical absences, failed download cleanup, slot capacity and local production-card configuration guard.');
} finally {globalThis.fetch=previousFetch;await rm(temp,{recursive:true,force:true});}
