import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const temporary = await mkdtemp(join(tmpdir(), 'fsd-backups-test-'));
try {
  const output = join(temporary, 'backups.mjs');
  await build({ stdin: { contents: `export * from './app/lib/production-backups/local-production'; export * from './app/lib/production-backups/model'; export * from './app/lib/production-backups/coordinator'; export * from './app/lib/production-backups/workflow'; export * from './app/lib/production-backups/cloud'; export * from './app/lib/production-backups/http';`, resolveDir: process.cwd() }, outfile: output, bundle: true, format: 'esm', platform: 'node', plugins: [{ name: 'runtime', setup(build) {
    build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'runtime', namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env; } } export class WorkflowEntrypoint { constructor(ctx,env) { this.ctx=ctx; this.env=env; } }' }));
    build.onResolve({ filter: /^\.\.\/storage$/ }, () => ({ path: 'storage', namespace: 'storage' }));
    build.onLoad({ filter: /.*/, namespace: 'storage' }, () => ({ contents: 'export const withStorage = (env, callback) => callback();' }));
  } }] });
  const { nextWeekly, localToUtc, sixMonthsAfter, ProductionBackupCoordinator, ProductionBackupWorkflow, prepareSqlForD1Import, replaceProductionDatabase, schemaFingerprint, localProductionRequest, workingDatabase, backupManagement, productionRequest, generationScript } = await import(pathToFileURL(output));
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
  source.exec("PRAGMA foreign_keys=ON");
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
  // Rehearse against the complete application schema, including RESTRICT links,
  // deletion triggers, views, AUTOINCREMENT sequences and task relationships.
  const school = new DatabaseSync(':memory:');
  for (const migration of JSON.parse(await readFile('app/lib/production-backups/migrations.generated.json', 'utf8'))) school.exec(migration.statements.join('\n'));
  school.exec("PRAGMA foreign_keys=ON; INSERT INTO students (first_name,last_name,email) VALUES ('Synthetic','Student',''); INSERT INTO admin_profiles (email,name) VALUES ('owner@example.test','Owner'); INSERT INTO manual_tasks (title,sort_order,created_by,created_at,updated_by,updated_at,request_key,request_payload) VALUES ('Restored task',3,'owner@example.test','2026-09-15','owner@example.test','2026-09-15','restore-task-key','{}'); INSERT INTO task_students(task_id,student_id) VALUES (1,1); UPDATE sqlite_sequence SET seq=90 WHERE name='students';");
  const quoteValue = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";
  const schoolObjects = school.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
  let schoolDump = schoolObjects.map(row => row.sql + ';').join('\n');
  for (const { name } of schoolObjects.filter(row => row.type === 'table')) {
    for (const row of school.prepare(`SELECT * FROM "${name}"`).all()) schoolDump += `INSERT INTO "${name}" VALUES (${Object.values(row).map(quoteValue).join(',')});`;
  }
  schoolDump += 'DELETE FROM sqlite_sequence;';
  for (const row of school.prepare('SELECT * FROM sqlite_sequence').all()) schoolDump += `INSERT INTO sqlite_sequence VALUES (${Object.values(row).map(quoteValue).join(',')});`;
  const originalSchema = await schemaFingerprint(d1(school));
  school.exec("UPDATE students SET first_name='Outgoing'; UPDATE manual_tasks SET title='Outgoing task'");
  await replaceProductionDatabase(d1(school), schoolDump, 'full-schema-test', 'restores/full-schema/');
  assert.equal(school.prepare('SELECT first_name FROM students').get().first_name, 'Synthetic');
  assert.equal(school.prepare('SELECT title FROM manual_tasks').get().title, 'Restored task');
  assert.equal(school.prepare("SELECT seq FROM sqlite_sequence WHERE name='students'").get().seq, 90);
  assert.equal(school.prepare('SELECT COUNT(*) AS n FROM task_students').get().n, 1);
  assert.equal(await schemaFingerprint(d1(school)), originalSchema);
  assert.deepEqual(school.prepare('PRAGMA foreign_key_check').all(), []);
  if (process.argv.includes('--d1')) {
    const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
    const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'restore-test', modules: true, script: 'export default { fetch() { return new Response("test"); } }', compatibilityDate: '2026-09-03', d1Databases: ['DB'] }] }));
    try {
      const native = await runtime.getD1Database('DB');
      await replaceProductionDatabase(native, schoolDump, 'native-seed', 'restores/native-seed/');
      await native.prepare("UPDATE students SET first_name='Outgoing'").run();
      await replaceProductionDatabase(native, schoolDump, 'native-restore', 'restores/native-restore/');
      assert.equal((await native.prepare('SELECT first_name FROM students').first()).first_name, 'Synthetic');
      assert.equal((await native.prepare('SELECT restore_job FROM _fsd_production_storage').first()).restore_job, 'native-restore');
      assert.equal((await native.prepare("SELECT seq FROM sqlite_sequence WHERE name='students'").first()).seq, 90);
      assert.equal((await native.prepare('SELECT COUNT(*) AS n FROM task_students').first()).n, 1);
      assert.equal(await schemaFingerprint(native), originalSchema);
      assert.deepEqual((await native.prepare('PRAGMA foreign_key_check').all()).results, []);
      let batchNumber = 0;
      const failing = { prepare: sql => native.prepare(sql), batch: statements => native.batch(++batchNumber === 2 ? [...statements, native.prepare("INSERT INTO students (id, first_name, last_name, email) VALUES (1, 'Duplicate', 'Student', '')")] : statements) };
      await assert.rejects(replaceProductionDatabase(failing, schoolDump, 'native-failed', 'restores/native-failed/'));
      assert.equal((await native.prepare('SELECT restore_job FROM _fsd_production_storage').first()).restore_job, 'native-restore');
      console.log('PASS: complete application schema restored and verified in isolated native D1 runtime.');
    } finally { await runtime.dispose(); }
  }
  school.close();

  class Bucket {
    objects = new Map();
    async put(key, body, metadata={}) { const bytes=Buffer.from(await new Response(body).arrayBuffer()); const etag=createHash('md5').update(bytes).digest('hex'); this.objects.set(key,{bytes,etag,...metadata}); return { key,size:bytes.length,etag }; }
    async head(key) { const object=this.objects.get(key); return object?{key,size:object.bytes.length,etag:object.etag,writeHttpMetadata(){}}:null; }
    async get(key) { const object=this.objects.get(key); return object?{key,size:object.bytes.length,etag:object.etag,body:new Response(object.bytes).body,text:async()=>object.bytes.toString(),httpMetadata:object.httpMetadata,customMetadata:object.customMetadata}:null; }
    async list({prefix='',cursor,limit=1000}={}) { const all=[...this.objects.keys()].filter(k=>k.startsWith(prefix)).sort(); const start=cursor?Number(cursor):0; const keys=all.slice(start,start+limit); return {delimitedPrefixes:[],objects:await Promise.all(keys.map(k=>this.head(k))),truncated:start+limit<all.length,cursor:String(start+limit)}; }
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
    if(url.hostname==='free-spirit-dance.alexandru-croitoriu.dev') return backupManagement(new Request(input, options), env, false);
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
      {
        const db = id === 'original' ? source : databases.get(id).db;
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

    // Restoring keeps the bound database; a preview alone uses fsd-backup-*.
    const restore = coordinator.reserve('activate', backup.id, '', 'owner', 1);
    await run(restore);
    assert.equal(coordinator.status().active, 'production');
    assert.equal(coordinator.status().generation, 2);
    assert.equal(importCount, 1);
    assert.equal(coordinator.enter('1', true).status, 409);
    const firstPrefix = source.prepare('SELECT image_prefix FROM _fsd_production_storage').get().image_prefix;
    assert.equal(photos.objects.get(firstPrefix + 'photo.jpg').bytes.toString(), 'synthetic-photo');
    source.exec("UPDATE students SET name='Current production'; INSERT INTO classes VALUES (2); INSERT INTO attendance VALUES (1,2)");
    await photos.put(firstPrefix + 'photo.jpg', 'current-photo');
    assert.deepEqual(bucket.objects.get(`snapshots/${backup.id}/database.sql`).bytes, snapshotBytes);
    const activeBackup = coordinator.backup(backup.id);
    const working = workingDatabase(env, activeBackup.databaseId);
    assert.equal((await working.prepare('SELECT name FROM students').first()).name, 'Synthetic student');
    const countBeforePreview = coordinator.status().backups.length;
    await run(coordinator.reserve('activate', backup.id, '', 'owner', 2, undefined, true));
    assert.equal(coordinator.status().active, backup.id);
    assert.equal(coordinator.status().readOnly, true);
    assert.equal(coordinator.status().previewPrevious, 'production');
    assert.equal(coordinator.status().backups.length, countBeforePreview);
    assert.equal(coordinator.enter(String(coordinator.status().generation), true).status, 403);
    const read = new Request('https://school.test/api/students');
    assert.equal((await (await productionRequest(read, env, async (_request, scoped) => Response.json(await scoped.DB.prepare('SELECT name FROM students').first()))).json()).name, 'Synthetic student');
    assert.equal(source.prepare('SELECT name FROM students').get().name, 'Current production');
    assert.throws(() => coordinator.reserve('delete', backup.id, '', 'owner'), /preview/);
    await run(coordinator.reserve('return', '', '', 'owner', coordinator.status().generation));
    assert.equal(coordinator.status().active, 'production');
    assert.equal(coordinator.status().backups.length, countBeforePreview);
    assert.throws(() => coordinator.reserve('return', '', '', 'owner', coordinator.status().generation), /preview/);
    const readProduction = await productionRequest(read, env, async (_request, scoped) => {
      assert.equal(await (await scoped.STUDENT_IMAGES.get('photo.jpg')).text(), 'current-photo');
      return Response.json(await scoped.DB.prepare('SELECT name FROM students').first());
    });
    assert.equal((await readProduction.json()).name, 'Current production');

    const request=(body,email='croitoriu.alexandru.code@gmail.com',origin='https://school.test')=>new Request('https://school.test/api/administrators/production-backups',{method:'POST',headers:{'cf-access-authenticated-user-email':email,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await backupManagement(request({action:'backup'},'other@test'),env,false)).status,403);
    assert.equal((await backupManagement(request({action:'backup'},undefined,'https://evil.test'),env,false)).status,403);
    const localBridge=new Request('https://school.test/api/administrators/production-backups',{method:'POST',headers:{'X-FSD-Local-Backup-Bridge':'local-bridge-test-secret','Content-Type':'application/json'},body:JSON.stringify({action:'schedule',enabled:false,weekday:6,time:'04:00',once:null})});
    assert.equal((await backupManagement(localBridge,env,false)).status,202);
    assert.equal((await backupManagement(request({action:'schedule',enabled:true,weekday:9,time:'04:00',once:null}),env,false)).status,400);
    assert.equal((await backupManagement(request({action:'backup'}),env,true)).status,200);
    const oldSave=new Request('https://school.test/api/students',{method:'POST',headers:{Origin:'https://school.test','X-FSD-Generation':'1'}});
    assert.equal((await productionRequest(oldSave,env,async()=>{throw new Error('Stale write reached app');})).status,409);

    const localEnv = { ...env, CLOUDFLARE_ACCESS_CLIENT_ID: 'test', CLOUDFLARE_ACCESS_CLIENT_SECRET: 'test', LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET: 'local-bridge-test-secret' };
    const localRead = new Request('http://localhost:3000/api/students');
    assert.equal((await localProductionRequest(localRead, env, async () => { throw new Error('Unconfigured connection admitted'); })).status, 503);
    const currentFetch = globalThis.fetch;
    const browserPage = new Request('http://localhost:3000/', { headers: { Accept: 'text/html' } });
    globalThis.fetch = async () => Response.json({ error: 'Unknown backup action.' }, { status: 400 });
    const outdated = await localProductionRequest(browserPage, localEnv, async () => { throw new Error('Old deployment bypassed admission'); });
    assert.equal(outdated.status, 503);
    const recoveryPage = await outdated.text();
    assert.match(recoveryPage, /deployed app needs the production connection update/);
    assert.match(recoveryPage, /Open Catalog/);
    assert.match(recoveryPage, /\/api\/development-storage/);
    const outdatedApi = await localProductionRequest(localRead, localEnv, async () => { throw new Error('Old deployment admitted API request'); });
    assert.equal(outdatedApi.status, 503);
    assert.match((await outdatedApi.json()).error, /Deploy it/);
    let managementGet = false;
    globalThis.fetch = async (_url, options) => { managementGet = !options.method || options.method === 'GET'; return Response.json({ available: true, generation: 3 }); };
    const adminShell = await localProductionRequest(new Request('http://localhost:3000/administrators'), localEnv, async () => new Response('administrators'));
    assert.equal(adminShell.status, 200);
    assert.equal(managementGet, true, 'Administrators use the backward-compatible read-only status endpoint');
    globalThis.fetch = currentFetch;
    const localResult = await localProductionRequest(localRead, localEnv, async () => {
      assert.equal(coordinator.pending(), 1, 'Local reads participate in draining');
      return Response.json({ ok: true }, { status: 201 });
    });
    assert.equal(localResult.status, 201);
    assert.equal(localResult.headers.get('X-FSD-Generation'), String(coordinator.status().generation));
    assert.equal(coordinator.pending(), 0);
    await assert.rejects(localProductionRequest(localRead, localEnv, async () => { throw new Error('Local handler failure'); }), /Local handler failure/);
    assert.equal(coordinator.pending(), 0);
    const localSave = new Request('http://localhost:3000/api/students', { method: 'POST', headers: { Origin: 'http://localhost:3000', 'X-FSD-Generation': '1' } });
    assert.equal((await localProductionRequest(localSave, localEnv, async () => { throw new Error('Stale local save admitted'); })).status, 409);
    assert.equal((await backupManagement(request({ action: 'enter-local-production', mutation: false, generation: null }), env, false)).status, 400, 'Admission is restricted to the authenticated bridge');

    // Safety backup contains all outgoing records and the matching image namespace.
    await run(coordinator.reserve('activate', backup.id, '', 'owner', coordinator.status().generation));
    assert.equal(source.prepare('SELECT name FROM students').get().name, 'Synthetic student');
    assert.equal(source.prepare('SELECT COUNT(*) AS n FROM attendance').get().n, 1);
    const safety = coordinator.status().backups.find(b => b.category === 'automatic' && bucket.objects.get(`snapshots/${b.id}/images/photo.jpg`)?.bytes.toString() === 'current-photo');
    assert.ok(safety);
    assert.match(bucket.objects.get(`snapshots/${safety.id}/database.sql`).bytes.toString(), /Current production/);
    assert.equal(coordinator.status().active, 'production');

    // Every restore invalidates old pages, even when the database ID is unchanged.
    const generation = coordinator.status().generation;
    await run(coordinator.reserve('activate', backup.id, '', 'owner', generation));
    assert.equal(coordinator.status().generation, generation + 1);
    assert.equal(coordinator.enter(String(generation), true).status, 409);
    const before = coordinator.status();
    const pending = coordinator.enter(String(before.generation), true);
    await assert.rejects(run(coordinator.reserve('activate', backup.id, '', 'owner', before.generation)));
    assert.equal(coordinator.status().maintenance, null);
    coordinator.leave(pending.ticket);
    failExport = true;
    await assert.rejects(run(coordinator.reserve('activate', backup.id, '', 'owner', coordinator.status().generation)));
    assert.equal(coordinator.status().active, 'production');
    assert.equal(coordinator.status().maintenance, null);
    failExport = false;

    // A transaction failure after DROP rolls everything back and retains maintenance.
    const nativeBatch = env.DB.batch;
    env.DB.batch = async statements => nativeBatch(statements.some(s => s.sql.startsWith('DROP ')) ? [...statements, env.DB.prepare('INSERT INTO missing_restore_table VALUES (1)')] : statements);
    const failedRestore = coordinator.reserve('activate', safety.id, '', 'owner', coordinator.status().generation);
    await assert.rejects(run(failedRestore));
    assert.equal(source.prepare('SELECT name FROM students').get().name, 'Synthetic student');
    assert.equal(coordinator.status().maintenance, failedRestore.id);
    assert.ok(coordinator.status().job.error);
    assert.equal(coordinator.enter(String(coordinator.status().generation), false).status, 503);
    assert.equal((await localProductionRequest(localRead, localEnv, async () => { throw new Error('Local read during restore'); })).status, 503);
    const failedSafety = coordinator.backup(coordinator.status().job.safetyBackupId);
    const failedSafetyBytes = Buffer.from(bucket.objects.get(`snapshots/${failedSafety.id}/database.sql`).bytes);
    env.DB.batch = nativeBatch;
    await run(failedRestore);
    assert.equal(coordinator.status().maintenance, null);
    assert.equal(source.prepare('SELECT name FROM students').get().name, 'Current production');
    assert.deepEqual(bucket.objects.get(`snapshots/${failedSafety.id}/database.sql`).bytes, failedSafetyBytes, 'Retry preserves the original safety snapshot');

    // Lost success responses are reconciled using the marker committed with the data.
    env.DB.batch = async statements => { const result = await nativeBatch(statements); if (statements.some(s => s.sql.startsWith('DROP '))) throw new Error('Lost response after commit'); return result; };
    await assert.rejects(run(coordinator.reserve('activate', backup.id, '', 'owner', coordinator.status().generation)));
    env.DB.batch = nativeBatch;
    assert.equal(coordinator.status().job, null);
    assert.equal(coordinator.status().active, 'production');
    assert.equal(source.prepare('SELECT name FROM students').get().name, 'Synthetic student');

    // Migrate an existing live backup with edits newer than its deleted snapshot.
    await working.prepare('UPDATE students SET name=? WHERE id=1').bind('Today live attendance').run();
    await working.prepare('INSERT INTO classes VALUES (3)').run();
    await working.prepare('INSERT INTO attendance VALUES (1,3)').run();
    await bucket.put(`working/${backup.id}/photo.jpg`, 'latest-live-photo');
    const legacyControl = { ...coordinator.status(), active: backup.id, readOnly: false };
    ctx.storage.sql.exec('UPDATE records SET value = ? WHERE key = ?', JSON.stringify(legacyControl), 'control');
    const legacyBackup = { ...coordinator.backup(backup.id), snapshotDeleted: true };
    ctx.storage.sql.exec('UPDATE records SET value = ? WHERE key = ?', JSON.stringify(legacyBackup), `backup:${backup.id}`);
    await bucket.delete(`snapshots/${backup.id}/database.sql`);
    assert.equal((await localProductionRequest(localRead, localEnv, async () => { throw new Error('Original database mislabeled live'); })).status, 409);
    assert.equal(coordinator.pending(), 0);
    const normalize = coordinator.reserve('normalize', '', '', 'owner', coordinator.status().generation);
    await run(normalize);
    assert.equal(coordinator.status().active, 'production');
    assert.equal(source.prepare('SELECT name FROM students').get().name, 'Today live attendance');
    assert.equal(source.prepare('SELECT COUNT(*) AS n FROM attendance').get().n, 2);
    const normalizedPrefix = source.prepare('SELECT image_prefix FROM _fsd_production_storage').get().image_prefix;
    assert.equal(photos.objects.get(normalizedPrefix + 'photo.jpg').bytes.toString(), 'latest-live-photo');
    assert.throws(() => coordinator.reserve('normalize', '', '', 'owner', coordinator.status().generation), /existing live/);
    await run(coordinator.reserve('delete', backup.id, '', 'owner'));
    assert.ok(!databases.has(activeBackup.databaseId));
    assert.equal(source.prepare('SELECT name FROM students').get().name, 'Today live attendance');
    assert.equal(photos.objects.get(normalizedPrefix + 'photo.jpg').bytes.toString(), 'latest-live-photo');

    // Scheduled backups export the stable production database and only its active photos.
    coordinator.schedule({enabled:true,weekday:6,time:'04:00',once:null});
    const due=coordinator.status().schedule.next;
    const scheduled=coordinator.tick(Date.parse(due));assert.equal(scheduled.kind,'backup');
    assert.equal(coordinator.tick(Date.parse(due)).id,scheduled.id);
    await run(scheduled);
    assert.equal(coordinator.tick(Date.parse(due)),null);
    const automatic=coordinator.backup(scheduled.backupId);
    assert.equal(automatic.category,'automatic');
    assert.equal(automatic.photos,105);
    assert.throws(()=>coordinator.rename(automatic.id,'Changed'),/read-only/);
    const download = (mode, extra = {}, email = 'croitoriu.alexandru.code@gmail.com') => backupManagement(new Request('https://school.test/api/administrators/production-backups?' + new URLSearchParams({download:mode,id:automatic.id,...extra}), {headers:{'cf-access-authenticated-user-email':email}}),env,false);
    assert.equal((await download('metadata', {}, 'other@test')).status,403);
    assert.equal((await (await download('metadata')).json()).name,automatic.name);
    assert.match(await (await download('sql')).text(),/Today live attendance/);
    const imagesPage=await (await download('images')).json();assert.equal(imagesPage.keys.length,100);assert.ok(imagesPage.cursor);
    assert.equal((await download('image',{key:'../database.sql'})).status,400);
    assert.equal(await (await download('image',{key:'photo.jpg'})).text(),'latest-live-photo');
    const manualJob=coordinator.reserve('backup','','Manual from automatic','owner',undefined,automatic.id);
    await run(manualJob);
    assert.equal(coordinator.backup(manualJob.backupId).category,'manual');
    await run(coordinator.reserve('activate',automatic.id,'','owner',coordinator.status().generation,undefined,true));
    const priorAutomaticDb=coordinator.backup(automatic.id).databaseId;
    await run(coordinator.reserve('return','','','owner',coordinator.status().generation));
    await run(coordinator.reserve('activate',automatic.id,'','owner',coordinator.status().generation));
    assert.notEqual(coordinator.backup(automatic.id).databaseId,priorAutomaticDb);
    assert.equal(coordinator.status().active,'production');
    coordinator.schedule({enabled:false,weekday:6,time:'04:00',once:null});
    let expired;
    while ((expired=coordinator.tick(Date.parse(automatic.expiresAt)+86400000))) await run(expired);
    assert.equal(coordinator.status().backups.length,0);
    assert.equal(source.prepare('SELECT name FROM students').get().name,'Today live attendance');
    assert.equal(new ProductionBackupCoordinator(ctx,env).status().active,'production');

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
    console.log('PASS: production backup snapshots, photos/pagination, editable restore and return, stable production restore, previews, atomic rollback, commit recovery, live migration, stale saves, permissions, failure recovery, retention, restart, weekly timezone/DST and duplicate scheduling.');
  } finally { globalThis.fetch=originalFetch; }
} finally { await rm(temporary,{recursive:true,force:true}); }
