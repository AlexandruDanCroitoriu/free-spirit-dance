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
  await build({ stdin: { contents: `export * from './app/lib/task-filters'; export * from './app/lib/task-move'; export * from './app/lib/tasks'; export * from './app/lib/tasks-client'; export {default as Card} from './app/components/task-card'; export {default as Filters} from './app/components/task-filters'; export {default as Panel} from './app/components/task-panel'; export {default as DragBoard} from './app/components/task-drag-board';`, resolveDir: resolve('.'), loader: 'tsx' }, outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'] });
  const { readTaskFilters, writeTaskFilters, matchesTask, schoolToday, taskColumns, taskRequest, TaskRequestError, taskMoveFromOrder, Card, Filters, Panel, DragBoard } = await import(pathToFileURL(outfile).href);
  const order = { todo: ['a', 'b', 'c'], in_progress: [], done: ['d'] };
  assert.equal(taskMoveFromOrder('a', order, order), null);
  assert.equal(taskMoveFromOrder('missing', order, order), null);
  assert.deepEqual(taskMoveFromOrder('c', order, { ...order, todo: ['c', 'a', 'b'] }), { key: 'c', status: 'todo', position: 'before', targetKey: 'a' });
  assert.deepEqual(taskMoveFromOrder('a', order, { ...order, todo: ['b', 'c', 'a'] }), { key: 'a', status: 'todo', position: 'after', targetKey: 'c' });
  assert.deepEqual(taskMoveFromOrder('a', order, { ...order, todo: ['b', 'c'], done: ['a', 'd'] }), { key: 'a', status: 'done', position: 'before', targetKey: 'd' });
  assert.deepEqual(taskMoveFromOrder('a', order, { ...order, todo: ['b', 'c'], in_progress: ['a'] }), { key: 'a', status: 'in_progress', position: 'bottom' });
  assert.deepEqual(taskMoveFromOrder('a', { todo: ['a'], done: ['d'] }, { todo: [], done: ['d', 'a'] }), { key: 'a', status: 'done', position: 'after', targetKey: 'd' }); // Relative to visible cards, never a replacement for hidden rows.
  const defaults = readTaskFilters(new URLSearchParams());
  assert.deepEqual(defaults, { view: 'all', due: 'all', status: 'all', completed: true, dismissed: false, studentId: null });
  assert.deepEqual(readTaskFilters(new URLSearchParams('view=bad&due=bad&status=bad&studentId=-1')), defaults);
  const selected = { view: 'manual', due: '7', status: 'todo', completed: false, dismissed: false, studentId: 3 };
  assert.deepEqual(readTaskFilters(writeTaskFilters(selected)), selected);
  assert.equal(writeTaskFilters(defaults, new URLSearchParams('view=manual&studentId=3&unrelated=kept')).toString(), 'unrelated=kept');
  const task = { key: 'manual:1', source: 'manual', category: 'manual', title: '<Task title>', description: 'Task notes', dueDate: null, status: 'todo', student: { id: 3, name: 'Test Student' }, sortOrder: 0, dismissed: false, canEditContent: true, canDelete: true, createdBy: '', updatedBy: '', createdAt: '', updatedAt: '' };
  const match = (changes = {}, filter = {}, today = '2026-12-28') => matchesTask({ ...task, ...changes }, { ...defaults, ...filter }, today);
  assert.equal(match(), true);
  for (const due of ['overdue', 'today', '7', '30']) assert.equal(match({}, { due }), false);
  assert.equal(match({ dueDate: '2026-12-27' }, { due: 'overdue' }), true);
  assert.equal(match({ dueDate: '2026-12-28' }, { due: 'overdue' }), false);
  assert.equal(match({ dueDate: '2026-12-27', status: 'done' }, { due: 'overdue' }), false);
  assert.equal(match({ dueDate: '2026-12-28' }, { due: 'today' }), true);
  for (const dueDate of ['2026-12-28', '2027-01-04']) assert.equal(match({ dueDate }, { due: '7' }), true);
  for (const dueDate of ['2026-12-27', '2027-01-05']) assert.equal(match({ dueDate }, { due: '7' }), false);
  assert.equal(match({ dueDate: '2027-01-27' }, { due: '30' }), true);
  assert.equal(match({ dueDate: '2027-01-28' }, { due: '30' }), false);
  assert.equal(match({ dueDate: '2028-03-01' }, { due: '7' }, '2028-02-23'), true);
  assert.equal(match({ dueDate: '2026-04-01' }, { due: '7' }, '2026-03-25'), true);
  assert.equal(schoolToday(new Date('2026-09-15T21:30:00Z')), '2026-09-16');
  assert.equal(match({ status: 'done' }), true);
  assert.equal(match({ status: 'done' }, { completed: false }), false);
  assert.equal(match({ dismissed: true }), false);
  assert.equal(match({ dismissed: true }, { dismissed: true }), true);
  assert.equal(match({ dismissed: true, dueDate: '2026-12-27' }, { dismissed: true, due: 'overdue' }), false);
  const birthday = { ...task, source: 'automatic', category: 'birthday', canEditContent: false, canDelete: false };
  assert.equal(matchesTask(birthday, { ...defaults, view: 'birthday' }, '2026-12-28'), true);
  assert.equal(match({}, { view: 'birthday' }), false);
  assert.deepEqual(readTaskFilters(writeTaskFilters({ ...defaults, view: 'birthday', dismissed: true })), { ...defaults, view: 'birthday', dismissed: true });
  assert.equal(readTaskFilters(new URLSearchParams('view=synthetic'), ['all', 'manual', 'synthetic']).view, 'synthetic');
  const automaticCard = renderToStaticMarkup(createElement(Card, { task: birthday, categoryTitle: 'Student Birthdays', columns: taskColumns, today: '2026-12-28', onAction() {}, onMove() {} }));
  assert.match(automaticCard, /Automatic/);
  assert.match(automaticCard, /Student Birthdays/);
  assert.match(automaticCard, /Dismiss/);
  assert.match(automaticCard, /Remove student link/);
  assert.doesNotMatch(automaticCard, /Edit &lt;Task title/);
  assert.equal(match({ source: 'automatic' }, { view: 'manual' }), false);
  assert.equal(match({}, selected), false); // No due date despite matching student/status/source.
  assert.equal(match({}, { studentId: 4 }), false);
  const card = renderToStaticMarkup(createElement(Card, { task, columns: taskColumns, today: '2026-09-15', disabled: false, canTop: true, canBottom: true, onEdit() {}, onStudent() {}, onMove() {} }));
  assert.match(card, /&lt;Task title&gt;/);
  assert.match(card, /href="\/students\?student=3"/);
  for (const label of ['Move up', 'Move down', 'Move to top', 'Move to bottom', 'Status for']) assert.ok(card.includes(label));
  assert.match(card, /disabled="">Move up/);
  assert.doesNotMatch(card, /disabled="">Move to top/); // Hidden earlier tasks still permit absolute movement.
  const filters = renderToStaticMarkup(createElement(Filters, { value: defaults, columns: taskColumns, students: [], onChange() {} }));
  for (const label of ['All tasks', 'Manual tasks', 'Next 7 days', 'Next 30 days', 'Include completed tasks']) assert.ok(filters.includes(label));
  const panel = renderToStaticMarkup(createElement(Panel, { task, board: { tasks: [task], revision: 1, today: '2026-09-15', columns: taskColumns }, studentId: null, onClose() {}, onSaved() {} }));
  assert.match(panel, /<dialog[^>]*aria-labelledby="task-editor-title"/);
  assert.match(panel, /maxLength="200"/);
  assert.match(panel, /value="3" selected="">Test Student/); // Preserve link before student list loads.
  assert.match(panel, /Delete task/);
  const dragBoard = renderToStaticMarkup(createElement(DragBoard, { board: { tasks: [task], revision: 1, today: '2026-09-15', columns: taskColumns }, columns: taskColumns, visible: [task], today: '2026-09-15', disabled: false, onDragging() {}, onEdit() {}, onStudent() {}, async onMove() {} }));
  assert.match(dragBoard, /Drag &lt;Task title&gt;/);
  assert.match(dragBoard, /touch-none/);
  assert.match(dragBoard, /Drop a task here/);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'Board changed' }, { status: 409 });
    await assert.rejects(taskRequest('/api/tasks'), error => error instanceof TaskRequestError && error.status === 409);
    globalThis.fetch = async () => new Response('<html>Sign in</html>');
    await assert.rejects(taskRequest('/api/tasks'), /unexpected response/);
  } finally { globalThis.fetch = originalFetch; }
  console.log('PASS: task date boundaries, combined and URL filters, accessible cards/editor, student links, and request errors.');
} finally { await rm(directory, { recursive: true, force: true }); }
