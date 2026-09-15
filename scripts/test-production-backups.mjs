import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const temporary = await mkdtemp(join(tmpdir(), 'fsd-backups-test-'));
try {
  const output = join(temporary, 'backups.mjs');
  await build({ stdin: { contents: `export * from './app/lib/production-backups/model'; export * from './app/lib/production-backups/coordinator'; export * from './app/lib/production-backups/workflow'; export * from './app/lib/production-backups/cloud'; export * from './app/lib/production-backups/http';`, resolveDir: process.cwd() }, outfile: output, bundle: true, format: 'esm', platform: 'node', plugins: [{ name: 'runtime', setup(build) {
    build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'runtime', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env; } } export class WorkflowEntrypoint { constructor(ctx,env) { this.ctx=ctx; this.env=env; } }' }));
    build.onResolve({ filter: /^\.\.\/storage$/ }, () => ({ path: 'storage', namespace: 'storage' }));
    build.onLoad({ filter: /.*/, namespace: 'storage' }, () => ({ contents: 'export const withStorage = (env, callback) => callback();' }));
  } }] });
  const { nextWeekly, localToUtc, sixMonthsAfter, ProductionBackupCoordinator, ProductionBackupWorkflow, prepareSqlForD1Import, workingDatabase, backupManagement, productionRequest, generationScript } = await import(pathToFileURL(output));
  assert.equal(nextWeekly(Date.parse('2026-03-27T10:00Z')), '2026-03-28T02:00:00.000Z');
  const { backupTable } = await import(pathToFileURL(output));
  assert.equal(backupTable({ category: 'automatic', name: 'Before production switch · 2026-09-15 11:50 UTC' }), 'production-change');
  assert.equal(backupTable({ category: 'automatic', name: 'Production 2026-09-15 11:50 UTC' }), 'automatic');
  assert.equal(backupTable({ category: 'manual', name: 'Before production switch · My manual backup' }), 'manual');
  assert.equal(backupTable({ name: 'Legacy manual backup' }), 'manual');
  assert.equal(nextWeekly(Date.parse('2026-03-28T02:00Z')), '2026-04-04T01:00:00.000Z');
  assert.equal(nextWeekly(Date.parse('2026-10-24T01:00Z')), '2026-10-31T02:00:00.000Z');
  assert.equal(localToUtc('2026-10-25T03:30'), '2026-10-25T00:30:00.000Z');
  assert.throws(() => localToUtc('2026-03-29T03:30'));
  assert.throws(() => localToUtc('2026-02-30T04:00'));
  assert.equal(sixMonthsAfter('2026-08-31T01:00:00Z'), '2027-02-28T01:00:00.000Z');
  assert.equal(sixMonthsAfter('2027-08-31T01:00:00Z'), '2028-02-29T01:00:00.000Z');
  const reordered = prepareSqlForD1Import("PRAGMA defer_foreign_keys=TRUE; BEGIN; CREATE TABLE attendance (class_id INTEGER REFERENCES classes(id)); INSERT INTO attendance VALUES (1); CREATE TABLE classes (id INTEGER PRIMARY KEY); INSERT INTO classes VALUES (1); CREATE TRIGGER attendance_check BEFORE INSERT ON attendance BEGIN SELECT 1; END; COMMIT;");
  assert.ok(reordered.indexOf("CREATE TABLE classes") < reordered.indexOf("INSERT INTO attendance"));
  assert.ok(reordered.indexOf("INSERT INTO classes") < reordered.indexOf("INSERT INTO attendance"));
  assert.ok(reordered.indexOf("INSERT INTO classes") < reordered.indexOf("CREATE TRIGGER"));
  assert.ok(reordered.includes("BEGIN SELECT 1; END;"));
  const reorderedDatabase = new DatabaseSync(':memory:');
  reorderedDatabase.exec("PRAGMA foreign_keys=ON; BEGIN;" + reordered + " COMMIT;");
  assert.equal(reorderedDatabase.prepare("SELECT COUNT(*) AS count FROM attendance").get().count, 1);

  function state() {
    const db = new DatabaseSync(':memory:');
    return { storage: { sql: { exec(sql, ...params) { const query = db.prepare(sql); const rows = query.columns().length ? query.all(...params) : (query.run(...params), []); return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } }; } }, transactionSync(fn) { db.exec('BEGIN'); try { const result = fn(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } } } };
  }
  const source = new DatabaseSync(':memory:');
  source.exec("CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT NOT NULL, picture TEXT); CREATE TABLE classes (id INTEGER PRIMARY KEY); CREATE TABLE attendance (student_id INTEGER REFERENCES students(id), class_id INTEGER REFERENCES classes(id)); INSERT INTO students VALUES (1, 'Synthetic student', '/api/student-images/photo.jpg'); INSERT INTO classes VALUES (1); INSERT INTO attendance VALUES (1, 1);");
  // Mimic D1's table-by-table export: attendance appears before classes even
  // though its rows refer to classes. The uploaded prepared SQL must fix that.
  const dump = "CREATE TABLE \"students\" (id INTEGER PRIMARY KEY, name TEXT NOT NULL, picture TEXT); INSERT INTO students VALUES (1, 'Synthetic student', '/api/student-images/photo.jpg'); CREATE TABLE \"attendance\" (student_id INTEGER REFERENCES students(id), class_id INTEGER REFERENCES classes(id)); INSERT INTO attendance VALUES (1, 1); CREATE TABLE \"classes\" (id INTEGER PRIMARY KEY); INSERT INTO classes VALUES (1);";
  function d1(db) {
    function prepare(sql, params=[]) {
      return { sql, params, bind(...params) { return prepare(sql, params); }, async all() { return execute(sql, params); }, async first() { return execute(sql, params).results[0] ?? null; }, async run() { return execute(sql,params); } };
    }
    function execute(sql, params=[]) { const q=db.prepare(sql); const results=q.columns().length?q.all(...params):(q.run(...params),[]); return { success:true,results,meta:{} }; }
    return { prepare, async batch(statements) { db.exec('BEGIN'); try { const result=statements.map(s=>execute(s.sql,s.params)); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } } };
  }
  class Bucket {
    objects = new Map();
    async put(key, body, metadata={}) { const bytes=Buffer.from(await new Response(body).arrayBuffer()); const etag=createHash('md5').update(bytes).digest('hex'); this.objects.set(key,{bytes,etag,...metadata}); return { key,size:bytes.length,etag }; }
    async head(key) { const object=this.objects.get(key); return object?{key,size:object.bytes.length,etag:object.etag}:null; }
    async get(key) { const object=this.objects.get(key); return object?{key,size:object.bytes.length,etag:object.etag,body:new Response(object.bytes).body,text:async()=>object.bytes.toString(),httpMetadata:object.httpMetadata,customMetadata:object.customMetadata}:null; }
    async list({prefix='',cursor,limit=1000}={}) { const all=[...this.objects.keys()].filter(k=>k.startsWith(prefix)).sort(); const start=cursor?Number(cursor):0; const keys=all.slice(start,start+limit); return {objects:await Promise.all(keys.map(k=>this.head(k))),truncated:start+limit<all.length,cursor:String(start+limit)}; }
    async delete(keys) { for(const key of Array.isArray(keys)?keys:[keys]) this.objects.delete(key); }
  }
  const bucket = new Bucket(), photos = new Bucket();
  await photos.put('photo.jpg', 'synthetic-photo', { httpMetadata:{contentType:'image/jpeg'} });
  await photos.put('administrator.jpg', 'synthetic-admin-photo');
  // Exercise pagination rather than only a single image page.
  for(let i=0;i<103;i++) await photos.put(`extra-${i}.jpg`, 'synthetic');
  const env = { DB:d1(source), STUDENT_IMAGES:photos, BACKUP_BUCKET:bucket, BACKUP_PRODUCTION_DATABASE_ID:'original', BACKUP_ACCOUNT_ID:'test', BACKUP_API_TOKEN:'test-only', LOCAL_BACKUP_BRIDGE_SECRET:'local-bridge-test-secret', PUBLIC_QR_BASE_URL:'https://go.test' };
  const ctx=state(); const coordinator=new ProductionBackupCoordinator(ctx,env);
  env.PRODUCTION_BACKUPS={getByName:()=>coordinator}; env.BACKUP_WORKFLOW={create:async()=>{},get:async()=>({status:async()=>({status:'running'})})};
  const originalFetch=globalThis.fetch;
  const databases=new Map(); let failUpload=false, importCount=0, exportCount=0, uploadedSql='', uploadedEtag='';
  const apiCalls=[];
  let exportDump = dump;
  let failExport = false;
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url);
    apiCalls.push({url:url.href,method:options.method??'GET'});
    if(url.hostname==='download.test')return new Response(exportDump);
    if(url.hostname==='upload.test') {
      uploadedSql=await new Response(options.body).text();
      uploadedEtag=createHash('md5').update(uploadedSql).digest('hex');
      return new Response(null,{status:failUpload?500:200});
    }
    assert.equal(url.hostname,'api.cloudflare.com');
    const root='/client/v4/accounts/test/d1/database'; const path=url.pathname.slice(root.length); const body=options.body?JSON.parse(options.body):null;
    const response=result=>Response.json({success:true,result});
    if(path===''&&(options.method==='GET'))return response([...databases].filter(([,v])=>v.name===url.searchParams.get('name')).map(([uuid,v])=>({uuid,name:v.name})));
    if(path==='') { const id=crypto.randomUUID();databases.set(id,{db:new DatabaseSync(':memory:'),name:body.name});return response({uuid:id}); }
    const [,id,operation]=path.split('/');
    if(operation==='export'){
      if (failExport) return Response.json({ success: false }, { status: 500 });
      exportDump = dump;
      if (id !== 'original') {
        const db = databases.get(id).db;
        exportDump = db.prepare("SELECT sql FROM sqlite_master WHERE type='table'").all().map(row => row.sql + ';').join('\n');
        for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
          for (const row of db.prepare(`SELECT * FROM ${name}`).all()) exportDump += `INSERT INTO ${name} VALUES (${Object.values(row).map(value => value === null ? 'NULL' : typeof value === 'number' ? value : "'" + value.replaceAll("'", "''") + "'").join(',')});`;
        }
      }
      exportCount++; return response({status:'complete',result:{signed_url:'https://download.test/sql'}});
    }
    assert.notEqual(id,'original','Original production must never be imported into, queried via REST, or deleted');
    const database=databases.get(id);assert.ok(database);
    if(options.method==='DELETE'){databases.delete(id);return response({});}
    if(operation==='import'){
      if(body.action==='init')return response({filename:'dump.sql',upload_url:'https://upload.test/sql'});
      assert.equal(body.etag,uploadedEtag,'D1 must ingest the checksum of the transformed upload');
      importCount++;database.db.exec(uploadedSql);return response({status:'complete'});
    }
    if(operation==='query') {
      assert.ok(Array.isArray(body.batch),'D1 REST queries use the documented batch envelope');
      const db=d1(database.db);return response(await db.batch(body.batch.map(s=>db.prepare(s.sql).bind(...s.params))));
    }
    throw new Error(`Unexpected mocked API operation: ${operation}`);
  };
  const step=()=>({async do(_name,config,fn){return (fn??config)();},async sleep(){}});
  const run=job=>new ProductionBackupWorkflow({},env).run({payload:job},step());
  const recoveryState = state();
  const recovery = new ProductionBackupCoordinator(recoveryState, env);
  recovery.enter('1', true);
  assert.throws(() => recovery.recoverRequests(), /recent/);
  recoveryState.storage.sql.exec('UPDATE requests SET started_at = ?', new Date(Date.now() - 11 * 60_000).toISOString());
  const recoveryJob = recovery.reserve('backup', '', '', 'owner');
  assert.throws(() => recovery.recoverRequests(), /current backup/);
  recovery.finish(recoveryJob.id, true);
  assert.equal(recovery.recoverRequests(), 1);
  assert.equal(recovery.pending(), 0);
  assert.equal(recovery.enter('1', true).status, 409);
  assert.equal(recovery.status().backups.length, 1);
  const keptAlive = [];
  await assert.rejects(productionRequest(new Request('https://school.test/api/students'), env, async () => { throw new Error('Interrupted handler'); }, { waitUntil(promise) { keptAlive.push(promise); } }), /Interrupted handler/);
  await Promise.all(keptAlive);
  assert.equal(keptAlive.length, 1);
  assert.equal(coordinator.pending(), 0);
  try {
    assert.equal(coordinator.enter('0',true).status,409);
    const ticket=coordinator.enter('1',true); assert.ok(ticket.ticket);
    const job=coordinator.reserve('backup','','Test backup','owner');
    assert.throws(()=>coordinator.reserve('backup','','','owner'));
    coordinator.lock(job.id); assert.equal(coordinator.pending(),1);
    assert.equal(coordinator.enter('1',true).status,503);
    coordinator.leave(ticket.ticket);assert.equal(coordinator.pending(),0);
    await run(job);
    const backup=coordinator.backup(job.backupId);
    assert.equal(backup.status,'ready'); assert.equal(backup.photos,105); assert.ok(backup.bytes>0);
    assert.equal(coordinator.status().maintenance,null);
    const snapshotBytes=Buffer.from(bucket.objects.get(`snapshots/${backup.id}/database.sql`).bytes);
    assert.ok(bucket.objects.has(`snapshots/${backup.id}/images/administrator.jpg`));
    assert.ok(!bucket.objects.has(`working/${backup.id}/photo.jpg`));

    await run(coordinator.reserve('activate',backup.id,'','owner',1));
    assert.equal(coordinator.status().active,backup.id);assert.equal(coordinator.status().generation,2);
    assert.equal(importCount,1);
    assert.equal(coordinator.enter('1',true).status,409);
    const active=coordinator.backup(backup.id);
    const working=workingDatabase(env,active.databaseId);
    await working.prepare('UPDATE students SET name=? WHERE id=?').bind('Edited working copy',1).run();
    assert.equal((await working.prepare('SELECT name FROM students').first()).name,'Edited working copy');
    assert.equal(source.prepare('SELECT name FROM students').get().name,'Synthetic student');
    assert.deepEqual(bucket.objects.get(`snapshots/${backup.id}/database.sql`).bytes,snapshotBytes);

    // Saving while a backup copy is active still exports original production.
    await run(coordinator.reserve('backup','','Original while copy active','owner'));
    assert.equal(exportCount,3);
    await run(coordinator.reserve('return','','','owner',2));
    assert.equal(coordinator.status().active,'production');assert.equal(coordinator.status().generation,3);
    await run(coordinator.reserve('activate',backup.id,'','owner',3));
    assert.equal(importCount,1,'Reactivation preserves edits instead of reimporting');
    assert.equal((await working.prepare('SELECT name FROM students').first()).name,'Edited working copy');

    const request=(body,email='croitoriu.alexandru.code@gmail.com',origin='https://school.test')=>new Request('https://school.test/api/administrators/production-backups',{method:'POST',headers:{'cf-access-authenticated-user-email':email,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await backupManagement(request({action:'backup'},'other@test'),env,false)).status,403);
    assert.equal((await backupManagement(request({action:'backup'},undefined,'https://evil.test'),env,false)).status,403);
    const localBridge=new Request('https://school.test/api/administrators/production-backups',{method:'POST',headers:{'X-FSD-Local-Backup-Bridge':'local-bridge-test-secret','Content-Type':'application/json'},body:JSON.stringify({action:'schedule',enabled:false,weekday:6,time:'04:00',once:null})});
    assert.equal((await backupManagement(localBridge,env,false)).status,202);
    assert.equal((await backupManagement(request({action:'schedule',enabled:true,weekday:9,time:'04:00',once:null}),env,false)).status,400);
    assert.equal((await backupManagement(request({action:'backup'}),env,true)).status,200);
    assert.equal((await backupManagement(request({action:'backup'}),env,true)).headers.get('Cache-Control'),'no-store');
    const oldSave=new Request('https://school.test/api/students',{method:'POST',headers:{Origin:'https://school.test','X-FSD-Generation':'1'}});
    assert.equal((await productionRequest(oldSave,env,async()=>{throw new Error('Stale write reached app');})).status,409);
    const read=new Request('https://school.test/api/students');
    const response=await productionRequest(read,env,async(_request,scoped)=>{
      await scoped.STUDENT_IMAGES.put('photo.jpg','edited-photo');
      return Response.json(await scoped.DB.prepare('SELECT name FROM students').first());
    });
    assert.equal((await response.json()).name,'Edited working copy');assert.equal(coordinator.pending(),0);
    assert.equal(photos.objects.get('photo.jpg').bytes.toString(),'synthetic-photo');
    assert.equal(bucket.objects.get(`snapshots/${backup.id}/images/photo.jpg`).bytes.toString(),'synthetic-photo');
    assert.equal(bucket.objects.get(`working/${backup.id}/photo.jpg`).bytes.toString(),'edited-photo');

    // In-flight requests prevent a switch; failure leaves the original choice.
    const before=coordinator.status();const pending=coordinator.enter(String(before.generation),true);
    await assert.rejects(run(coordinator.reserve('return','','','owner',before.generation)));
    assert.equal(coordinator.status().active,before.active);assert.equal(coordinator.status().maintenance,null);
    coordinator.leave(pending.ticket);
    await run(coordinator.reserve('return','','','owner',before.generation));
    const safetyCopy = coordinator.status().backups.find(b => b.category === 'automatic' && bucket.objects.get(`snapshots/${b.id}/images/photo.jpg`)?.bytes.toString() === 'edited-photo');
    assert.ok(safetyCopy, 'Switch saves current working photos');
    assert.match(bucket.objects.get(`snapshots/${safetyCopy.id}/database.sql`).bytes.toString(), /Edited working copy/);
    const unused=coordinator.status().backups.find(b=>b.id!==backup.id && b.category === 'manual');
    failUpload=true;
    await assert.rejects(run(coordinator.reserve('activate',unused.id,'','owner',coordinator.status().generation)));
    assert.equal(coordinator.status().active,'production');assert.equal(coordinator.backup(unused.id).workingReady,undefined);
    failUpload=false;
    await run(coordinator.reserve('activate',unused.id,'','owner',coordinator.status().generation));
    assert.equal(coordinator.status().active,unused.id);
    await run(coordinator.reserve('return','','','owner',coordinator.status().generation));
    await run(coordinator.reserve('delete',unused.id,'','owner'));
    assert.throws(()=>coordinator.backup(unused.id));
    assert.ok(![...bucket.objects.keys()].some(k=>k.includes(unused.id)));

    // Retention protects active copies, expires inactive copies, and survives restart.
    await run(coordinator.reserve('activate',backup.id,'','owner',coordinator.status().generation));
    coordinator.schedule({enabled:false,weekday:6,time:'04:00',once:null});
    const future=Date.parse(backup.expiresAt)+1;
    let expired;
    while ((expired = coordinator.tick(future))) await run(expired);
    assert.equal(coordinator.status().active, backup.id);
    const restarted=new ProductionBackupCoordinator(ctx,env);
    assert.equal(restarted.status().active,backup.id);
    await run(coordinator.reserve('return','','','owner',coordinator.status().generation));
    const cleanup=coordinator.tick(future);assert.equal(cleanup.kind,'delete');await run(cleanup);
    assert.ok(!coordinator.status().backups.some(b => b.id === backup.id));
    assert.equal(source.prepare('SELECT name FROM students').get().name,'Synthetic student');

    coordinator.schedule({enabled:true,weekday:6,time:'04:00',once:null});
    const due=coordinator.status().schedule.next;
    const scheduled=coordinator.tick(Date.parse(due));assert.equal(scheduled.kind,'backup');
    assert.equal(coordinator.tick(Date.parse(due)).id,scheduled.id,'Duplicate delivery reuses the same job');
    await run(scheduled);
    assert.equal(coordinator.tick(Date.parse(due)),null);
    const automatic = coordinator.backup(scheduled.backupId);
    assert.equal(automatic.category, 'automatic');
    assert.throws(() => coordinator.rename(automatic.id, 'Changed'), /read-only/);
    const automaticBytes = Buffer.from(bucket.objects.get(`snapshots/${automatic.id}/database.sql`).bytes);
    const download = (mode, extra = {}, email = 'croitoriu.alexandru.code@gmail.com') => backupManagement(new Request('https://school.test/api/administrators/production-backups?' + new URLSearchParams({download:mode,id:automatic.id,...extra}), {headers:{'cf-access-authenticated-user-email':email}}),env,false);
    assert.equal((await download('metadata', {}, 'other@test')).status, 403);
    assert.equal((await (await download('metadata')).json()).name, automatic.name);
    assert.equal(await (await download('sql')).text(), automaticBytes.toString());
    const imagesPage = await (await download('images')).json();
    assert.equal(imagesPage.keys.length, 100);
    assert.ok(imagesPage.cursor);
    assert.equal((await download('image', {key:'../database.sql'})).status, 400);
    assert.equal(await (await download('image', {key:'photo.jpg'})).text(), 'synthetic-photo');
    assert.equal(coordinator.status().job, null, 'Snapshot downloads do not switch or reserve production');
    const manualJob = coordinator.reserve('backup', '', 'Manual from automatic', 'owner', undefined, automatic.id);
    await run(manualJob);
    assert.equal(coordinator.backup(manualJob.backupId).category, 'manual');
    assert.deepEqual(bucket.objects.get(`snapshots/${manualJob.backupId}/database.sql`).bytes, automaticBytes);
    failExport = true;
    const blockedSwitch = coordinator.reserve('activate', manualJob.backupId, '', 'owner', coordinator.status().generation);
    await assert.rejects(run(blockedSwitch));
    assert.equal(coordinator.status().active, 'production', 'Failed safety snapshot prevents switching');
    failExport = false;
    const manualCount = coordinator.status().backups.filter(b => b.category === 'manual').length;
    const automaticCount = coordinator.status().backups.filter(b => b.category === 'automatic').length;
    const automaticSwitch = coordinator.reserve('activate', automatic.id, '', 'owner', coordinator.status().generation);
    await run(automaticSwitch);
    assert.equal(coordinator.status().active, automatic.id);
    assert.equal(coordinator.backup(coordinator.status().active).category, 'automatic');
    assert.equal(coordinator.status().backups.filter(b => b.category === 'manual').length, manualCount);
    assert.equal(coordinator.status().backups.filter(b => b.category === 'automatic').length, automaticCount + 1);
    assert.deepEqual(bucket.objects.get(`snapshots/${automatic.id}/database.sql`).bytes, automaticBytes);
    const productionBeforePreview = coordinator.status().active;
    const snapshotsBeforePreview = coordinator.status().backups.length;
    await run(coordinator.reserve('activate', manualJob.backupId, '', 'owner', coordinator.status().generation, undefined, true));
    assert.equal(coordinator.status().readOnly, true);
    assert.equal(coordinator.status().previewPrevious, productionBeforePreview);
    assert.equal(coordinator.status().backups.length, snapshotsBeforePreview);
    assert.equal(coordinator.enter(String(coordinator.status().generation), true).status, 403);
    const denied = await productionRequest(new Request('https://school.test/api/students', { method: 'POST', headers: { Origin: 'https://school.test', 'X-FSD-Generation': String(coordinator.status().generation) } }), env, async () => { throw new Error('Read-only write reached application'); });
    assert.equal(denied.status, 403);
    assert.throws(() => coordinator.reserve('delete', manualJob.backupId, '', 'owner'), /preview/);
    await run(coordinator.reserve('return', '', '', 'owner', coordinator.status().generation));
    assert.equal(coordinator.status().active, productionBeforePreview);
    assert.equal(coordinator.status().readOnly, false);
    assert.equal(coordinator.status().backups.length, snapshotsBeforePreview);

    const priorAutomaticDb = coordinator.backup(automatic.id).databaseId;
    databases.get(priorAutomaticDb).db.exec("UPDATE students SET name='Edited production'");
    await bucket.put(`working/${automatic.id}/extra.jpg`, 'new photo');
    await run(coordinator.reserve('activate', manualJob.backupId, '', 'owner', coordinator.status().generation));
    await run(coordinator.reserve('activate', automatic.id, '', 'owner', coordinator.status().generation));
    const restoredAutomaticDb = coordinator.backup(automatic.id).databaseId;
    assert.notEqual(restoredAutomaticDb, priorAutomaticDb);
    assert.equal(databases.get(restoredAutomaticDb).db.prepare('SELECT name FROM students').get().name, 'Synthetic student');
    assert.equal(bucket.objects.has(`working/${automatic.id}/extra.jpg`), false);
    assert.deepEqual(bucket.objects.get(`snapshots/${automatic.id}/database.sql`).bytes, automaticBytes);
    assert.equal(coordinator.status().backups.filter(b => b.category === 'manual').length, manualCount);

    // Removing the production snapshot must not remove its live DB or photos.
    const liveId = coordinator.status().active;
    const liveDatabaseId = coordinator.backup(liveId).databaseId;
    const livePhoto = Buffer.from(bucket.objects.get(`working/${liveId}/photo.jpg`).bytes);
    await run(coordinator.reserve('delete', liveId, '', 'owner'));
    assert.equal(coordinator.status().active, liveId);
    assert.equal(coordinator.backup(liveId).snapshotDeleted, true);
    assert.equal(bucket.objects.has(`snapshots/${liveId}/database.sql`), false);
    assert.ok(databases.has(liveDatabaseId));
    assert.deepEqual(bucket.objects.get(`working/${liveId}/photo.jpg`).bytes, livePhoto);
    const liveTicket = coordinator.enter(String(coordinator.status().generation), true);
    assert.ok(liveTicket.ticket, 'Production remains writable after deleting its backup');
    coordinator.leave(liveTicket.ticket);
    assert.throws(() => coordinator.reserve('backup', '', '', 'owner', undefined, liveId), /source backup/);
    await run(coordinator.reserve('activate', manualJob.backupId, '', 'owner', coordinator.status().generation, undefined, true));
    assert.throws(() => coordinator.reserve('delete', manualJob.backupId, '', 'owner'), /preview/);
    await run(coordinator.reserve('delete', liveId, '', 'owner'));
    assert.ok(databases.has(liveDatabaseId), 'Underlying production is preserved during preview too');
    await run(coordinator.reserve('return', '', '', 'owner', coordinator.status().generation));
    assert.equal(coordinator.status().active, liveId);
    const safetyBefore = coordinator.status().backups.filter(b => b.category === 'automatic').length;
    await run(coordinator.reserve('activate', manualJob.backupId, '', 'owner', coordinator.status().generation));
    assert.equal(coordinator.status().backups.filter(b => b.category === 'automatic').length, safetyBefore + 1, 'Production without a saved backup is still safety-backed-up on switch');
    const cleanupDeleted = coordinator.tick(Date.now());
    assert.equal(cleanupDeleted.backupId, liveId);
    await run(cleanupDeleted);
    assert.equal(databases.has(liveDatabaseId), false);
    assert.equal(bucket.objects.has(`working/${liveId}/photo.jpg`), false);
    assert.throws(() => coordinator.backup(liveId), /not found/);

    // Recovery is restricted to the exact old deletion and confirmed shutdown.
    const recoveryCtx = state();
    const recoveryCoordinator = new ProductionBackupCoordinator(recoveryCtx, env);
    const recoveryBackup = recoveryCoordinator.reserve('backup', '', 'Recovery fixture', 'owner');
    recoveryCoordinator.updateBackup(recoveryBackup.id, { status: 'ready' });
    recoveryCoordinator.finish(recoveryBackup.id);
    const deletion = recoveryCoordinator.reserve('delete', recoveryBackup.backupId, '', 'owner');
    let workflowState = 'running', terminated = 0;
    let stopImmediately = false;
    const recoveryEnv = { ...env, PRODUCTION_BACKUPS: { getByName: () => recoveryCoordinator }, BACKUP_WORKFLOW: {
      create: async () => {}, get: async () => ({ status: async () => ({ status: workflowState }), terminate: async () => { terminated++; if (stopImmediately) workflowState = 'terminated'; } }),
    } };
    const recover = (jobId = deletion.id) => backupManagement(request({ action: 'recover-deletion', jobId }), recoveryEnv, false);
    assert.equal((await recover()).status, 400, 'Recent deletions cannot be recovered');
    assert.equal(terminated, 0);
    const oldControl = recoveryCoordinator.status();
    oldControl.job.startedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    recoveryCtx.storage.sql.exec('UPDATE records SET value = ? WHERE key = ?', JSON.stringify(oldControl), 'control');
    assert.equal((await recover(crypto.randomUUID())).status, 400);
    assert.equal((await recover()).status, 400, 'A still-running workflow must retain its lock');
    assert.equal(recoveryCoordinator.status().job.id, deletion.id);
    stopImmediately = true;
    assert.equal((await recover()).status, 202);
    assert.equal(recoveryCoordinator.status().job, null);
    assert.equal(recoveryCoordinator.backup(recoveryBackup.backupId).status, 'failed');
    assert.equal(recoveryCoordinator.status().active, 'production');
    const retryDelete = recoveryCoordinator.reserve('delete', recoveryBackup.backupId, '', 'owner');
    workflowState = 'complete';
    const { launchJob } = await import(pathToFileURL(output));
    await launchJob(recoveryEnv, retryDelete);
    assert.equal(recoveryCoordinator.status().job, null, 'Successful create responses also reconcile completed jobs');
    assert.throws(() => recoveryCoordinator.backup(recoveryBackup.backupId), /not found/);

    // Fetch wrapping pins a tab to its original generation, not a shared cookie.
    const calls=[];const context={window:{fetch:async(input,init)=>{calls.push({input,init});return new Response();}},location:{href:'https://school.test/',origin:'https://school.test'},URL,Request,Headers};
    vm.runInNewContext(generationScript(7).replace(/^<script>|<\/script>$/g,''),context);
    await context.window.fetch('/api/students',{method:'POST'});
    assert.equal(calls[0].init.headers.get('X-FSD-Generation'),'7');
    await context.window.fetch('https://other.test/api/students',{method:'POST'});
    assert.equal(calls[1].init.headers,undefined);
    console.log('PASS: production backup snapshots, photos/pagination, editable restore and return, original-only source, stale saves, permissions, failure recovery, retention, restart, weekly timezone/DST and duplicate scheduling.');
  } finally { globalThis.fetch=originalFetch; }
} finally { await rm(temporary,{recursive:true,force:true}); }
