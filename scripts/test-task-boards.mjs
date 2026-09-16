import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

// Real SQLite constraints/triggers and transactional batches, synthetic data only.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  let beforeMutation = null;
  const db = { sqlite, setBeforeMutation(callback) { beforeMutation = callback; }, prepare(sql) {
    let params = [];
    const statement = { sql, bind(...values) { params = values; return statement; },
      execute() { const query = sqlite.prepare(sql); const results = query.columns().length ? query.all(...params) : (query.run(...params), []); return { results, meta: { changes: Number(sqlite.prepare('SELECT changes() AS n').get().n) } }; },
      async first() { return statement.execute().results[0] ?? null; },
      async all() { return statement.execute(); }, async run() { return statement.execute(); },
    }; return statement;
  }, async batch(statements) {
    if (beforeMutation && statements.some(statement => statement.sql === 'UPDATE task_board_state SET revision = ? WHERE id = 1')) {
      const callback = beforeMutation; beforeMutation = null; callback();
    }
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return db;
}

const directory = mkdtempSync(join(tmpdir(), 'fsd-tasks-test-'));
const db = database();
const deletedImages = [];
globalThis.taskTestEnv = { DB: db, STUDENT_IMAGES: { async delete(key) { deletedImages.push(key); } } };
async function load(file, name) {
  const outfile = join(directory, `${name}.mjs`);
  await build({ entryPoints: [file], outfile, bundle: true, format: 'esm', platform: 'node', plugins: [{ name: 'test-storage', setup(context) {
    context.onLoad({ filter: /app\/lib\/storage\.ts$/ }, () => ({ contents: 'export const env = globalThis.taskTestEnv;', loader: 'ts' }));
  } }] });
  return import(pathToFileURL(outfile));
}
const owner = 'croitoriu.alexandru.code@gmail.com';
const admin = 'tasks@example.test';
const origin = 'https://school.test';
function request(method = 'GET', body, options = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: origin, 'cf-access-authenticated-user-email': admin, ...options.headers };
  return new Request(options.url ?? `${origin}/api/tasks`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
const context = key => ({ params: Promise.resolve({ key }) });
const listContext = id => ({ params: Promise.resolve({ id: String(id) }) });
const revision = () => db.sqlite.prepare('SELECT revision FROM task_board_state WHERE id=1').get().revision;
async function expect(response, status = 200) {
  const result = await response;
  const body = result.status === 204 ? null : await result.json();
  assert.equal(result.status, status, JSON.stringify(body));
  return body;
}

try {
  const api = await load('app/api/tasks/route.ts', 'tasks');
  const { taskMoveState } = await load('app/lib/tasks.ts', 'task-types');
  const item = await load('app/api/tasks/[key]/route.ts', 'task');
  const moves = await load('app/api/tasks/move/route.ts', 'move');
  const lists = await load('app/api/tasks/lists/route.ts', 'lists');
  const appearance = await load('app/api/tasks/appearance/route.ts', 'appearance');
  const listMoves = await load('app/api/tasks/lists/move/route.ts', 'list-move');
  const removeLists = await load('app/api/tasks/lists/[id]/route.ts', 'list-remove');
  const exporter = await load('app/api/administrators/export/route.ts', 'export');
  const transfer = await load('app/lib/local-database-transfer.ts', 'transfer');
  const clear = await load('app/api/administrators/clear-data/route.ts', 'clear');
  const ownerRequest = (method='GET', body) => request(method, body, {headers:{'cf-access-authenticated-user-email':owner}});
  const initial = await expect(api.GET(ownerRequest()));
  assert.deepEqual(initial.boards, [{id:1,name:'School',scope:'school',color:'default'}]);
  assert.deepEqual(initial.lists, [{id:1,boardId:1,title:'Tasks',sortOrder:0,color:'default'}]);
  await expect(lists.POST(request('POST', {})),403);
  await expect(appearance.PATCH(request('PATCH', {target:'inbox',color:'ocean',revision:revision()})),403);
  await expect(listMoves.POST(request('POST',{})),403);
  await expect(removeLists.DELETE(request('DELETE', {revision:revision()}), listContext(1)),403);
  await expect(lists.POST(ownerRequest('POST',{name:' ',scope:'school',revision:revision(),requestKey:'new-list-invalid-key'})),400);
  await expect(lists.POST(ownerRequest('POST',{name:'List',scope:'other',revision:revision(),requestKey:'new-list-invalid-key'})),400);
  const createList = async (name,scope='school') => expect(lists.POST(ownerRequest('POST',{name,scope,revision:revision(),requestKey:'new-list-'+name.replaceAll(' ','-')+'-test-key'})),201);
  const firstList = (await createList('Planning')).createdId;
  const listRetryRevision = revision();
  assert.equal((await expect(lists.POST(ownerRequest('POST',{name:'Planning',scope:'school',revision:0,requestKey:'new-list-Planning-test-key'})))).createdId,firstList);
  assert.equal(revision(),listRetryRevision);
  const secondList = (await createList('Booked')).createdId;
  const disposableList = (await createList('Disposable')).createdId;
  const create = async (title,status='todo',listId=firstList) => expect(api.POST(ownerRequest('POST',{title,listId,revision:revision(),requestKey:'new-task-'+title+'-test-key'})),201);
  const a = (await create('A')).task, b = (await create('B','done')).task, c = (await create('C')).task;
  const move = async values => expect(moves.POST(ownerRequest('POST',{...values,revision:revision()})));
  let updated = await move({key:c.key,listId:firstList,position:'before',targetKey:a.key});
  assert.deepEqual(updated.tasks.filter(task=>task.listId===firstList).map(task=>task.key),[c.key,a.key,b.key]);
  updated = await move({key:b.key,listId:secondList,position:'bottom'});
  await expect(moves.POST(ownerRequest('POST',{key:a.key,listId:firstList,position:'before',targetKey:b.key,revision:revision()})),409);
  const stale = revision(); await create('Other');
  await expect(moves.POST(ownerRequest('POST',{key:a.key,listId:secondList,position:'bottom',revision:stale})),409);
  await expect(item.PATCH(ownerRequest('PATCH',{listId:999,revision:revision()}),context(a.key)),400);
  await expect(item.PATCH(ownerRequest('PATCH',{description:'Updated',revision:revision()}),context(a.key)));
  assert.equal((await expect(item.GET(ownerRequest(),context(a.key)))).task.listId,firstList);
  assert.throws(()=>db.sqlite.prepare('DELETE FROM task_lists WHERE id=?').run(firstList),/FOREIGN KEY/);
  await expect(removeLists.DELETE(ownerRequest('DELETE', {revision:revision()}), listContext(firstList)),409);
  await expect(removeLists.DELETE(ownerRequest('DELETE', {revision:revision()}), listContext('not-a-list')),400);
  const removed = await expect(removeLists.DELETE(ownerRequest('DELETE', {revision:revision()}), listContext(disposableList)));
  assert.equal(removed.lists.some(list => list.id === disposableList), false);
  await expect(removeLists.DELETE(ownerRequest('DELETE', {revision:revision()}), listContext(disposableList)),400);
  // Inbox ownership is enforced for every task path, even for the school owner.
  db.sqlite.prepare("INSERT INTO administrator_permissions(email,can_tasks) VALUES (?,1)").run(admin);
  const directoryApi = await load('app/api/tasks/administrators/route.ts', 'task-administrators');
  const directory = await expect(directoryApi.GET(request()));
  assert.ok(directory.some(person => person.email === admin));
  assert.ok(directory.some(person => person.email === owner));
  const administratorDescription = 'fsd-rich-text-v1:' + JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'administratorMention', attrs: { id: admin, name: 'Test administrator' } }] }] });
  const assigned = (await expect(api.POST(ownerRequest('POST', { title: 'Administrator links', description: administratorDescription, administratorEmails: [owner], assignedTo: admin, revision: revision(), requestKey: 'administrator-links-test' })), 201)).task;
  assert.deepEqual(assigned.administratorEmails, [owner, admin].sort());
  assert.equal(assigned.assignedTo, admin);
  const notifications = await load('app/api/tasks/notifications/route.ts', 'notifications');
  // Private Inbox assignments never appear in dashboard School notifications.
  assert.deepEqual(await expect(notifications.GET(request())), []);
  await expect(item.PATCH(ownerRequest('PATCH', { listId: firstList, revision: revision() }), context(assigned.key)));
  assert.deepEqual((await expect(notifications.GET(request()))).map(task => task.id), [Number(assigned.key.split(':')[1])]);
  assert.deepEqual(await expect(notifications.GET(ownerRequest())), []);
  await expect(notifications.GET(request('GET', undefined, { headers: { 'cf-access-authenticated-user-email': 'unauthorized@example.test' } })), 403);
  await expect(item.PATCH(ownerRequest('PATCH', { assignedTo: 'unknown@example.test', revision: revision() }), context(assigned.key)), 400);
  const retainedAssignment = await expect(item.PATCH(ownerRequest('PATCH', { title: 'Retain administrator fields', revision: revision() }), context(assigned.key)));
  assert.equal(retainedAssignment.task.assignedTo, admin);
  assert.deepEqual(retainedAssignment.task.administratorEmails, [owner, admin].sort());
  const clearedAssignment = await expect(item.PATCH(ownerRequest('PATCH', { assignedTo: null, administratorEmails: [], description: '', revision: revision() }), context(assigned.key)));
  assert.equal(clearedAssignment.task.assignedTo, null);
  assert.deepEqual(clearedAssignment.task.administratorEmails, []);
  await expect(item.DELETE(ownerRequest('DELETE', { revision: revision() }), context(assigned.key)));
  const privateListInput={name:'My private list',scope:'personal',revision:revision(),requestKey:'admin-personal-list-key'};
  const adminList=(await expect(lists.POST(request('POST',privateListInput)),201)).createdId;
  const ownList=(await createList('Owner private','personal')).createdId;
  const selfAssigned = (await expect(api.POST(ownerRequest('POST', { title: 'Personal self assignment', listId: ownList, assignedTo: owner, revision: revision(), requestKey: 'personal-self-assignment-test' })), 201)).task;
  const urgencyTasks = [];
  for (const [index, dueDate] of ['2099-12-31', '2000-01-01', '2050-06-15'].entries()) {
    urgencyTasks.push((await expect(api.POST(ownerRequest('POST', { title: `Urgency ${index}`, dueDate, listId: index === 1 ? firstList : ownList, assignedTo: owner, revision: revision(), requestKey: `notification-urgency-test-${index}` })), 201)).task);
  }
  assert.deepEqual((await expect(notifications.GET(ownerRequest()))).map(task => task.dueDate), ['2000-01-01', '2050-06-15', '2099-12-31', null]);
  for (const task of urgencyTasks) await expect(item.DELETE(ownerRequest('DELETE', { revision: revision() }), context(task.key)));
  const privateNotifications = await expect(notifications.GET(ownerRequest()));
  assert.equal(privateNotifications.find(task => task.id === Number(selfAssigned.key.split(':')[1])).scope, 'personal');
  assert.deepEqual(await expect(notifications.GET(request())), []);
  // Assignment cannot expose a different administrator's private board.
  await expect(item.PATCH(ownerRequest('PATCH', { assignedTo: admin, revision: revision() }), context(selfAssigned.key)));
  assert.deepEqual(await expect(notifications.GET(request())), []);
  assert.deepEqual(await expect(notifications.GET(ownerRequest())), []);
  await expect(item.DELETE(ownerRequest('DELETE', { revision: revision() }), context(selfAssigned.key)));
  // Two administrators work on private boards with stale global revisions.
  const moveCard = (await create('Scoped-move-test', 'todo', ownList)).task;
  let moveView = await expect(api.GET(ownerRequest()));
  await expect(api.POST(request('POST', { title: 'Other private activity', listId: adminList, revision: revision(), requestKey: 'other-private-move-test' })), 201);
  const scopedMove = { key: moveCard.key, listId: null, position: 'bottom', revision: moveView.revision, moveState: taskMoveState(moveView, moveCard.key, null) };
  // Also simulate an unrelated write between the server read and transaction.
  db.setBeforeMutation(() => db.sqlite.prepare('UPDATE task_lists SET sort_order = sort_order WHERE id = ?').run(adminList));
  const movedPrivate = await expect(moves.POST(ownerRequest('POST', scopedMove)));
  assert.equal(movedPrivate.tasks.find(task => task.key === moveCard.key).listId, null);
  assert.equal(movedPrivate.tasks.some(task => task.title === 'Other private activity'), false);
  moveView = await expect(api.GET(ownerRequest()));
  const conflictingMove = { key: moveCard.key, listId: ownList, position: 'bottom', revision: moveView.revision, moveState: taskMoveState(moveView, moveCard.key, ownList) };
  await expect(item.PATCH(ownerRequest('PATCH', { title: 'Changed while dragging', revision: revision() }), context(moveCard.key)));
  await expect(moves.POST(ownerRequest('POST', conflictingMove)), 409);
  // A source/destination ordering change remains a real conflict too.
  moveView = await expect(api.GET(ownerRequest()));
  const orderConflict = { ...conflictingMove, revision: moveView.revision, moveState: taskMoveState(moveView, moveCard.key, ownList) };
  const extra = (await create('Destination-order-test', 'todo', ownList)).task;
  await expect(moves.POST(ownerRequest('POST', orderConflict)), 409);
  await expect(item.DELETE(ownerRequest('DELETE', { revision: revision() }), context(extra.key)));
  await expect(item.DELETE(ownerRequest('DELETE', { revision: revision() }), context(moveCard.key)));
  assert.equal((await expect(lists.POST(request('POST',privateListInput)))).createdId,adminList);
  await expect(lists.POST(ownerRequest('POST',privateListInput)),409);
  const personalBoardTask=(await expect(api.POST(request('POST',{title:'Board secret',listId:adminList,revision:revision(),requestKey:'private-board-card-key'})),201)).task;
  const ownerBoard=await expect(api.GET(ownerRequest()));
  assert.equal(ownerBoard.lists.some(list=>list.id===adminList),false);
  assert.equal(ownerBoard.tasks.some(task=>task.key===personalBoardTask.key),false);
  assert.equal((await expect(api.GET(request()))).lists.some(list=>list.id===ownList),false);
  await expect(item.GET(ownerRequest(),context(personalBoardTask.key)),404);
  await expect(item.PATCH(ownerRequest('PATCH',{title:'Stolen',revision:revision()}),context(personalBoardTask.key)),404);
  await expect(item.DELETE(ownerRequest('DELETE',{revision:revision()}),context(personalBoardTask.key)),404);
  await expect(moves.POST(ownerRequest('POST',{key:personalBoardTask.key,listId:firstList,position:'bottom',revision:revision()})),404);
  await expect(removeLists.DELETE(ownerRequest('DELETE',{revision:revision()}),listContext(adminList)),400);
  await expect(api.POST(ownerRequest('POST',{title:'Forbidden',listId:adminList,revision:revision(),requestKey:'forbidden-create-key'})),400);
  await expect(item.PATCH(ownerRequest('PATCH',{listId:adminList,revision:revision()}),context(a.key)),400);
  await expect(moves.POST(ownerRequest('POST',{key:a.key,listId:adminList,position:'bottom',revision:revision()})),400);
  const newSchoolList=await createList('Shared response');
  assert.equal(newSchoolList.tasks.some(task=>task.key===personalBoardTask.key),false);
  assert.throws(()=>db.sqlite.prepare('INSERT INTO task_boards(name) VALUES (?)').run('Another school'),/UNIQUE/);
  assert.throws(()=>db.sqlite.prepare('UPDATE task_lists SET board_id=1 WHERE id=?').run(adminList),/cannot change/);
  const paint = async (values, own = false) => expect(appearance.PATCH((own ? ownerRequest : request)('PATCH', {...values, revision:revision()})));
  await paint({target:'inbox',color:'ocean'});
  await paint({target:'inbox',color:'rose'},true);
  await paint({target:'board',scope:'school',color:'navy'});
  await paint({target:'board',scope:'personal',color:'lilac'});
  await paint({target:'board',scope:'personal',color:'green'},true);
  await paint({target:'list',listId:adminList,color:'plum'});
  await paint({target:'list',listId:firstList,color:'gold'});
  const adminColors = await expect(api.GET(request())), ownerColors = await expect(api.GET(ownerRequest()));
  assert.equal(adminColors.inboxColor,'ocean'); assert.equal(ownerColors.inboxColor,'rose');
  assert.equal(adminColors.boards.find(board=>board.scope==='personal').color,'lilac');
  assert.equal(ownerColors.boards.find(board=>board.scope==='personal').color,'green');
  assert.equal(ownerColors.boards.find(board=>board.scope==='school').color,'navy');
  assert.equal(ownerColors.lists.find(list=>list.id===firstList).color,'gold');
  await expect(appearance.PATCH(ownerRequest('PATCH',{target:'list',listId:adminList,color:'blue',revision:revision()})),400);
  for (const values of [{target:'inbox',color:'url(https://bad.test)'},{target:'inbox',color:'blue',email:admin},{target:'board',scope:'other',color:'blue'}]) await expect(appearance.PATCH(ownerRequest('PATCH',{...values,revision:revision()})),400);
  const oldRevision = revision(); await paint({target:'inbox',color:'gray'});
  await expect(appearance.PATCH(ownerRequest('PATCH',{target:'inbox',color:'blue',revision:oldRevision})),409);
  const cardsBeforeListMove = db.sqlite.prepare('SELECT * FROM manual_tasks ORDER BY id').all();
  const reordered = await expect(listMoves.POST(ownerRequest('POST',{listId:secondList,targetId:1,position:'before',revision:revision()})));
  assert.equal(reordered.lists.filter(list=>list.boardId===1)[0].id,secondList);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM manual_tasks ORDER BY id').all(),cardsBeforeListMove);
  await expect(listMoves.POST(ownerRequest('POST',{listId:firstList,targetId:ownList,position:'after',revision:revision()})),400);
  await expect(listMoves.POST(ownerRequest('POST',{listId:adminList,targetId:firstList,position:'after',revision:revision()})),400);
  await expect(listMoves.POST(ownerRequest('POST',{listId:firstList,targetId:secondList,position:['before'],revision:revision()})),400);
  await expect(listMoves.POST(ownerRequest('POST',{listId:firstList,targetId:secondList,position:'after',revision:oldRevision})),409);
  await move({key:b.key,listId:ownList,position:'bottom'});
  assert.equal((await expect(api.GET(request()))).tasks.some(task=>task.key===b.key),false);
  await move({key:b.key,listId:firstList,position:'bottom'});
  assert.equal((await expect(api.GET(request()))).tasks.some(task=>task.key===b.key),true);
  db.sqlite.prepare("INSERT INTO students(first_name,last_name,email) VALUES ('Synthetic','Student','')").run();
  const personal = (await expect(api.POST(request('POST',{title:'Private draft',studentIds:[1],revision:revision(),requestKey:'private-admin-task-key'})),201)).task;
  assert.equal(personal.listId,null);
  const linked = await expect(api.GET(request('GET',undefined,{url:origin+'/api/tasks?studentId=1',headers:{'cf-access-authenticated-user-email':owner}})));
  assert.equal(linked.tasks.length,0,'Student panels must not leak private task relationships.');
  await expect(item.PATCH(request('PATCH',{inboxOwner:owner,revision:revision()}),context(personal.key)),400);
  const ownPersonal = (await expect(api.POST(ownerRequest('POST',{title:'Owner draft',revision:revision(),requestKey:'private-owner-task-key'})),201)).task;
  assert.equal((await expect(api.GET(ownerRequest()))).tasks.some(task=>task.key===personal.key),false);
  assert.equal((await expect(api.GET(request()))).tasks.some(task=>task.key===ownPersonal.key),false);
  for (const key of [personal.key]) {
    await expect(item.GET(ownerRequest(),context(key)),404);
    await expect(item.PATCH(ownerRequest('PATCH',{title:'Stolen',revision:revision()}),context(key)),404);
    await expect(item.DELETE(ownerRequest('DELETE',{revision:revision()}),context(key)),404);
    await expect(moves.POST(ownerRequest('POST',{key,listId:firstList,position:'bottom',revision:revision()})),404);
  }
  const beforePrivate = db.sqlite.prepare('SELECT * FROM manual_tasks WHERE id=?').get(Number(personal.key.slice(7)));
  const movedShared = await move({key:a.key,listId:null,position:'bottom'});
  assert.equal(movedShared.tasks.some(task=>task.key===personal.key),false);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM manual_tasks WHERE id=?').get(Number(personal.key.slice(7))),beforePrivate);
  await expect(moves.POST(request('POST',{key:personal.key,listId:firstList,position:'bottom',revision:revision()})));
  assert.equal((await expect(api.GET(ownerRequest()))).tasks.some(task=>task.key===personal.key),true);
  await expect(moves.POST(ownerRequest('POST',{key:ownPersonal.key,listId:null,position:'before',targetKey:personal.key,revision:revision()})),409);
  assert.deepEqual(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('automatic_task_occurrences','task_rule_state')").all(),[]);
  // Reindex a destination larger than one D1 JSON chunk without touching another Inbox.
  const insert = db.sqlite.prepare("INSERT INTO manual_tasks(title,list_id,sort_order,created_by,created_at,updated_by,updated_at,request_key,request_payload) VALUES (?, ?, ?, ?, '2026-09-16', ?, '2026-09-16', ?, '{}')");
  for(let index=0;index<505;index++) insert.run('Bulk '+index,firstList,index,owner,owner,'bulk-order-test-'+index);
  const largeMove=await move({key:ownPersonal.key,listId:firstList,position:'top'});
  const ordered=largeMove.tasks.filter(task=>task.listId===firstList);
  assert.equal(ordered[0].key,ownPersonal.key);
  assert.equal(new Set(ordered.map(task=>task.sortOrder)).size,ordered.length);
  const exported = await expect(exporter.GET(ownerRequest()));
  const copied=database();
  try { await transfer.replaceDatabase(copied,exported.tables,null);
    assert.deepEqual(copied.sqlite.prepare('SELECT * FROM task_preferences ORDER BY email').all(),db.sqlite.prepare('SELECT * FROM task_preferences ORDER BY email').all());
    assert.deepEqual(copied.sqlite.prepare('SELECT * FROM task_boards ORDER BY id').all(),db.sqlite.prepare('SELECT * FROM task_boards ORDER BY id').all());
    assert.deepEqual(copied.sqlite.prepare('SELECT * FROM task_lists ORDER BY id').all(),db.sqlite.prepare('SELECT * FROM task_lists ORDER BY id').all());
    assert.deepEqual(copied.sqlite.prepare('SELECT list_id,sort_order FROM manual_tasks ORDER BY id').all(),db.sqlite.prepare('SELECT list_id,sort_order FROM manual_tasks ORDER BY id').all());
  } finally { copied.sqlite.close(); }
  const withoutColors = exported.tables.filter(table=>table.name!=='task_preferences').map(table=>['task_boards','task_lists'].includes(table.name)?{...table,columns:table.columns.filter(column=>column!=='color'),rows:table.rows.map(({color,...row})=>row)}:table);
  const oldColorCopy=database();
  try {
    await transfer.replaceDatabase(oldColorCopy,withoutColors,null);
    assert.equal(oldColorCopy.sqlite.prepare("SELECT COUNT(*) n FROM task_boards WHERE color!='default'").get().n,0);
    assert.equal(oldColorCopy.sqlite.prepare('SELECT COUNT(*) n FROM task_preferences').get().n,0);
    assert.deepEqual(oldColorCopy.sqlite.prepare('SELECT * FROM manual_tasks ORDER BY id').all(),db.sqlite.prepare('SELECT * FROM manual_tasks ORDER BY id').all());
  } finally { oldColorCopy.sqlite.close(); }
  const legacy = exported.tables.filter(table => !['task_boards','task_lists'].includes(table.name)).map(table => {
    if (!['manual_tasks'].includes(table.name)) return table;
    return {...table, columns:['id','title','description','due_date','status','student_id','sort_order','created_by','created_at','updated_by','updated_at','request_key','request_payload'], rows:table.rows.map(({list_id,inbox_owner,...row})=>({...row,status:'todo',student_id:null}))};
  });
  legacy.push({name:'automatic_task_occurrences',columns:['id'],rows:[{id:1}]},{name:'task_rule_state',columns:['rule_key'],rows:[{rule_key:'retired'}]});
  const legacyCopy = database();
  try {
    await transfer.replaceDatabase(legacyCopy,legacy,null);
    assert.equal(legacyCopy.sqlite.prepare('SELECT name FROM task_boards WHERE id=1').get().name,'School');
    assert.equal(legacyCopy.sqlite.prepare('SELECT COUNT(*) AS n FROM manual_tasks WHERE list_id != 1 OR list_id IS NULL').get().n,0);
    assert.equal(legacyCopy.sqlite.prepare('SELECT COUNT(*) AS n FROM manual_tasks').get().n,exported.tables.find(table=>table.name==='manual_tasks').rows.length);
  } finally { legacyCopy.sqlite.close(); }
  db.sqlite.exec("INSERT INTO students(id,first_name,last_name,email) VALUES (90001,'Mention','Student',''); INSERT INTO courses(id,name) VALUES (90001,'Mention Course')");
  const description = 'fsd-rich-text-v1:' + JSON.stringify({type:'doc',content:[{type:'paragraph',content:[{type:'studentMention',attrs:{id:90001,name:'Mention Student'}},{type:'courseMention',attrs:{id:90001,name:'Mention Course'}}]}]});
  const mentioned = await expect(api.POST(ownerRequest('POST',{title:'Mentions',description,studentIds:[],courseIds:[],revision:revision(),requestKey:'mention-course-test-key'})),201);
  assert.deepEqual(mentioned.task.students.map(student=>student.id),[90001]);
  assert.deepEqual(mentioned.task.courses,[{id:90001,name:'Mention Course'}]);
  const stillLinked = await expect(item.PATCH(ownerRequest('PATCH',{studentIds:[],courseIds:[],revision:revision()}),context(mentioned.task.key)));
  assert.equal(stillLinked.task.courses.length,1);
  assert.equal(stillLinked.task.students.length,1);
  assert.throws(()=>db.sqlite.prepare('DELETE FROM courses WHERE id=90001').run(),/FOREIGN KEY/);
  await expect(item.PATCH(ownerRequest('PATCH',{courseIds:[999999],revision:revision()}),context(mentioned.task.key)),409);
  const unlinked = await expect(item.PATCH(ownerRequest('PATCH',{description:'',studentIds:[],courseIds:[],revision:revision()}),context(mentioned.task.key)));
  assert.equal(unlinked.task.courses.length,0);
  assert.equal(unlinked.task.students.length,0);
  await expect(clear.POST(ownerRequest('POST',{})));
  const empty=await expect(api.GET(ownerRequest()));
  assert.deepEqual(empty.boards,[{id:1,name:'School',scope:'school',color:'default'}]); assert.equal(empty.lists.length,1); assert.equal(empty.tasks.length,0);
  console.log('PASS: named boards/lists, permissions, validation, idempotency, cross-board placement, mixed-status order, conflicts, personal Inbox isolation, copies and clear.');
} finally {
  db.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
  delete globalThis.taskTestEnv;
}
