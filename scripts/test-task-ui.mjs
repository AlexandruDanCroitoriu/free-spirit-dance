import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const directory = await mkdtemp(resolve('.wrangler/task-ui-test-'));
try {
  const outfile = resolve(directory, 'fixture.mjs');
  await build({ stdin: { contents: `export * from './app/lib/task-filters'; export * from './app/lib/task-move'; export * from './app/lib/tasks'; export * from './app/lib/tasks-client'; export {default as Card} from './app/components/task-card'; export {default as Filters} from './app/components/task-filters'; export {default as Panel} from './app/components/task-panel'; export {default as DragBoard} from './app/components/task-drag-board';`, resolveDir: resolve('.'), loader: 'tsx' }, outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'] });
  const { readTaskFilters, writeTaskFilters, matchesTask, schoolToday, taskRequest, TaskRequestError, taskMoveFromOrder, Card, Filters, Panel, DragBoard } = await import(pathToFileURL(outfile).href);
  const lists = [{id:1,boardId:1,title:'Inbox',sortOrder:0},{id:2,boardId:1,title:'Planning',sortOrder:1}], boards = [{id:1,name:'School',scope:'school'}];
  const order = { '1': ['a', 'b', 'c'], '2': [], '3': ['d'] };
  assert.equal(taskMoveFromOrder('a', order, order), null);
  assert.equal(taskMoveFromOrder('missing', order, order), null);
  assert.deepEqual(taskMoveFromOrder('c', order, { ...order, '1': ['c', 'a', 'b'] }), { key: 'c', listId: 1, position: 'before', targetKey: 'a' });
  assert.deepEqual(taskMoveFromOrder('a', order, { ...order, '1': ['b', 'c', 'a'] }), { key: 'a', listId: 1, position: 'after', targetKey: 'c' });
  assert.deepEqual(taskMoveFromOrder('a', order, { ...order, '1': ['b', 'c'], '3': ['a', 'd'] }), { key: 'a', listId: 3, position: 'before', targetKey: 'd' });
  assert.deepEqual(taskMoveFromOrder('a', order, { ...order, '1': ['b', 'c'], '2': ['a'] }), { key: 'a', listId: 2, position: 'bottom' });
  assert.deepEqual(taskMoveFromOrder('a', { '1': ['a'], '3': ['d'] }, { '1': [], '3': ['d', 'a'] }), { key: 'a', listId: 3, position: 'after', targetKey: 'd' }); // Relative to visible cards, never a replacement for hidden rows.
  const defaults = readTaskFilters(new URLSearchParams());
  assert.deepEqual(defaults, { status: 'all', view: 'all', due: 'all', studentId: null });
  assert.deepEqual(readTaskFilters(new URLSearchParams('view=bad&due=bad&status=bad&studentId=-1')), defaults);
  const selected = { status: 'all', view: 'manual', due: '7', studentId: 3 };
  assert.deepEqual(readTaskFilters(writeTaskFilters(selected)), selected);
  assert.equal(writeTaskFilters(defaults, new URLSearchParams('view=manual&studentId=3&unrelated=kept')).toString(), 'unrelated=kept');
  const task = { key: 'manual:1', status: 'in_progress', courses: [], administratorEmails: [], assignedTo: null, listId: 1, source: 'manual', category: 'manual', title: '<Task title>', description: 'Task notes', dueDate: null, students: [{ id: 3, name: 'Test Student', picture: '/api/student-images/test' }], sortOrder: 0, canDelete: true, createdBy: '', updatedBy: '', createdAt: '', updatedAt: '' };
  const match = (changes = {}, filter = {}, today = '2026-12-28') => matchesTask({ ...task, ...changes }, { ...defaults, ...filter }, today);
  assert.equal(match(), true);
  for (const due of ['overdue', 'today', '7', '30']) assert.equal(match({}, { due }), false);
  assert.equal(match({ dueDate: '2026-12-27' }, { due: 'overdue' }), true);
  assert.equal(match({ dueDate: '2026-12-28' }, { due: 'overdue' }), false);
  assert.equal(match({ dueDate: '2026-12-28' }, { due: 'today' }), true);
  for (const dueDate of ['2026-12-28', '2027-01-04']) assert.equal(match({ dueDate }, { due: '7' }), true);
  for (const dueDate of ['2026-12-27', '2027-01-05']) assert.equal(match({ dueDate }, { due: '7' }), false);
  assert.equal(match({ dueDate: '2027-01-27' }, { due: '30' }), true);
  assert.equal(match({ dueDate: '2027-01-28' }, { due: '30' }), false);
  assert.equal(match({ dueDate: '2028-03-01' }, { due: '7' }, '2028-02-23'), true);
  assert.equal(match({ dueDate: '2026-04-01' }, { due: '7' }, '2026-03-25'), true);
  assert.equal(schoolToday(new Date('2026-09-15T21:30:00Z')), '2026-09-16');
  assert.equal(match({}, selected), false); // No due date despite matching student/status/source.
  assert.equal(match({}, { studentId: 4 }), false);
  const card = renderToStaticMarkup(createElement(Card, { lists, boards, students: [], task, today: '2026-09-15', disabled: false, canTop: true, canBottom: true, onEdit() {}, onStudent() {}, onMove() {} }));
  assert.match(card, /&lt;Task title&gt;/);
  assert.match(card, /aria-label="Open student: Test Student"/);
  assert.match(card, /<img[^>]*src="\/api\/student-images\/test"/);
  assert.doesNotMatch(card, />Test Student</);
  assert.doesNotMatch(card, /Move up|Move down|<details|Destination/);
  const filters = renderToStaticMarkup(createElement(Filters, { value: defaults, students: [], onChange() {} }));
  for (const label of ['All tasks', 'Manual tasks', 'Next 7 days', 'Next 30 days']) assert.ok(filters.includes(label));
  const panel = renderToStaticMarkup(createElement(Panel, { task, board: { lists, boards, tasks: [task], revision: 1, today: '2026-09-15' }, studentId: null, onClose() {}, onSaved() {} }));
  assert.match(panel, /<dialog[^>]*aria-labelledby="task-editor-title"/);
  assert.match(panel, /maxLength="200"/);
  assert.match(panel, /Students \(1\)/); // Preserve links before student choices load.
  assert.match(panel, /aria-label="Task status"/);
  assert.match(panel, /aria-haspopup="dialog"/);
  assert.match(panel, /Delete task/);
  const dragBoard = renderToStaticMarkup(createElement(DragBoard, { board: { lists, boards, tasks: [task], revision: 1, today: '2026-09-15' }, columns: lists, students: [], onAdd() {}, async onAddList() {}, async onSave() {}, async onRemoveList() {}, visible: [task], today: '2026-09-15', disabled: false, onDragging() {}, onEdit() {}, onStudent() {}, async onMove() {} }));
  assert.match(dragBoard, /Drag &lt;Task title&gt;/);
  assert.doesNotMatch(dragBoard, /⠿|<button[^>]*aria-label="Drag /);
  assert.match(dragBoard, /aria-roledescription="draggable card"/);
  assert.match(dragBoard, /class="[^"]*overflow-auto[^"]*"[^>]*aria-label="Task board"/);
  // Add-list controls live in TaskBoard and are exercised by the browser suite.
  assert.match(dragBoard, /Remove list/);
  assert.doesNotMatch(dragBoard, /Move left|Move right/);
  assert.deepEqual(taskMoveFromOrder('a', {'1':['a'],'2':[]}, {'1':[],'2':['a']}), {key:'a',listId:2,position:'bottom'});
  assert.match(dragBoard, /Inbox/);
  assert.deepEqual(taskMoveFromOrder('a', {'1':['a'],inbox:[]}, {'1':[],inbox:['a']}), {key:'a',listId:null,position:'bottom'});
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'Board changed' }, { status: 409 });
    await assert.rejects(taskRequest('/api/tasks'), error => error instanceof TaskRequestError && error.status === 409);
    globalThis.fetch = async () => new Response('<html>Sign in</html>');
    await assert.rejects(taskRequest('/api/tasks'), /unexpected response/);
  } finally { globalThis.fetch = originalFetch; }
  console.log('PASS: task date boundaries, combined and URL filters, accessible cards/editor, student links, and request errors.');
} finally { await rm(directory, { recursive: true, force: true }); }
