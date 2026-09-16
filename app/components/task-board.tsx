"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { matchesTask, readTaskFilters } from '../lib/task-filters';
import { schoolToday, taskMoveState, type BoardTask, type TaskBoard as Board } from '../lib/tasks';
import { taskRequest, TaskRequestError } from '../lib/tasks-client';
import TaskSettings from './task-settings';
import { taskBackground, type TaskColorChange, type TaskListMove } from '../lib/task-colors';
import TaskDragBoard from './task-drag-board';
import type { TaskMove } from '../lib/task-move';
import TaskPanel from './task-panel';
import StudentPanel from './student-panel';
import OperationNotification from './operation-notification';

export default function TaskBoard() {
  const [boardScope, setBoardScope] = useState<'school' | 'personal'>('school');
  const [board, setBoard] = useState<Board | null>(null);
  const [filters, setFilters] = useState(() => readTaskFilters(new URLSearchParams()));
  const [today, setToday] = useState(schoolToday);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [moving, setMoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [editor, setEditor] = useState<{ task: BoardTask | null; listId?: number | null } | null>(null);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const busy = useRef(false);
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError('');
    try {
      const storage = await taskRequest<{ readOnly?: boolean }>('/api/production-database');
      const data = await taskRequest<Board>('/api/tasks');
      if (sequence === loadSequence.current) { setReadOnly(!!storage.readOnly); setBoard(data); setBoardScope(new URL(window.location.href).searchParams.get('scope') === 'personal' ? 'personal' : data.selectedBoardScope); setToday(data.today); }
    }
    catch (reason) { if (sequence === loadSequence.current) setError(reason instanceof Error ? reason.message : 'Could not load tasks.'); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!board || loading) return;
    const url = new URL(window.location.href);
    const key = url.searchParams.get('task');
    if (!key) return;
    url.searchParams.delete('task');
    window.history.replaceState(null, '', url);
    const task = board.tasks.find(item => item.key === key);
    if (task) setEditor({ task });
    else setNotice('This task is no longer available.');
  }, [board, loading]);
  useEffect(() => {
    document.documentElement.classList.add('task-page-active');
    document.body.classList.add('task-page-active');
    return () => { document.documentElement.classList.remove('task-page-active'); document.body.classList.remove('task-page-active'); };
  }, []);
  useEffect(() => { setHeaderTarget(document.getElementById('task-page-header-actions')); }, []);
  useEffect(() => {
    const restore = () => { const params = new URLSearchParams(window.location.search); setFilters(readTaskFilters(params)); setBoardScope(params.get('scope') === 'personal' ? 'personal' : 'school'); };
    restore(); window.addEventListener('popstate', restore);
    const timer = window.setInterval(() => setToday(schoolToday()), 60_000);
    return () => { window.removeEventListener('popstate', restore); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (board && board.today !== today && !moving && !dragging && !editor && studentId === null) void load();
  }, [today, board, moving, dragging, editor, studentId, load]);
  useEffect(() => {
    if (!board || loading || moving || dragging || editor || studentId !== null) return;
    let cancelled = false;
    let refreshing = false;
    const refresh = () => {
      if (cancelled || refreshing || busy.current || document.visibilityState !== 'visible') return;
      refreshing = true;
      void taskRequest<Board>('/api/tasks').then(data => {
        if (!cancelled) { setBoard(data); setToday(data.today); }
      }).catch(() => {}).finally(() => { refreshing = false; });
    };
    const timer = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      cancelled = true; window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [board, loading, moving, dragging, editor, studentId]);
  async function move(change: TaskMove) {
    if (!board || busy.current || readOnly || loading || error) return;
    busy.current = true; setMoving(true); setNotice(''); setError('');
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      const updated = await taskRequest<Board>('/api/tasks/move', 'POST', { ...change, revision: board.revision, moveState: taskMoveState(board, change.key, change.listId) });
      setBoard(updated);
      const title = board.tasks.find(task => task.key === change.key)?.title ?? 'Task';
      setNotice(`${title} moved. The new position has been saved.`);
    } catch (reason) {
      setError(reason instanceof TaskRequestError && reason.status === 409 ? `${reason.message} Refresh the board, review its order, then try your move again.` : `${reason instanceof Error ? reason.message : 'Could not move task.'} The previous layout has been restored. Refresh to confirm the saved order before trying again.`);
    } finally {
      busy.current = false; setMoving(false);
      window.requestAnimationFrame(() => {
        const card = document.getElementById(`task-${change.key}`);
        if (focus?.isConnected && !focus.matches(':disabled')) focus.focus();
        else (card?.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled)') ?? document.getElementById('task-board-summary'))?.focus();
      });
    }
  }
  async function createCard(listId: number | null, title: string, requestKey: string) {
    if (!board || busy.current || readOnly || loading) throw new Error('Wait for the current operation to finish.');
    busy.current = true; setMoving(true);
    try {
      type Created = { task: BoardTask; revision: number };
      let current = board;
      let result: Created;
      try {
        result = await taskRequest<Created>('/api/tasks', 'POST', { title, listId, requestKey, revision: current.revision });
      } catch (reason) {
        // Creating a card has an idempotency key. A concurrent save cannot
        // overwrite this new card, so refresh the revision and retry once.
        if (!(reason instanceof TaskRequestError) || reason.status !== 409) throw reason;
        current = await taskRequest<Board>('/api/tasks');
        result = await taskRequest<Created>('/api/tasks', 'POST', { title, listId, requestKey, revision: current.revision });
      }
      setBoard({ ...current, revision: result.revision, tasks: [...current.tasks.filter(task => task.key !== result.task.key), result.task] });
      setNotice(listId === null ? 'Added to your private Inbox.' : 'Card added.');
    } finally { busy.current = false; setMoving(false); }
  }
  const activeBoard = board?.boards.find(item => item.scope === boardScope);
  const lists = board?.lists.filter(list => list.boardId === activeBoard?.id) ?? [];
  const visible = board?.tasks.filter(task => (task.listId === null || lists.some(list => list.id === task.listId)) && matchesTask(task, { ...filters, status: 'all' }, today)) ?? [];
  async function chooseBoard(scope: 'school' | 'personal') {
    if (scope === boardScope || loading || moving || dragging || readOnly || !!error) return;
    const previous = boardScope; setBoardScope(scope);
    const url = new URL(window.location.href); url.searchParams.delete('board'); url.searchParams.set('scope', scope); window.history.pushState(null, '', url);
    try { setBoard(await taskRequest<Board>('/api/tasks/preferences', 'PATCH', { selectedBoardScope: scope })); }
    catch (reason) { setBoardScope(previous); setError(reason instanceof Error ? reason.message : 'Could not save board preference.'); }
  }
  async function createList(name: string, requestKey: string) {
    if (!board || busy.current || readOnly || loading) throw new Error('Wait for the current operation to finish.');
    busy.current = true; setMoving(true);
    try {
      const result = await taskRequest<Board & { createdId: number }>('/api/tasks/lists', 'POST', { name, requestKey, revision: board.revision, scope: boardScope });
      setBoard(result); setError('');
      setNotice('List created.');
      window.requestAnimationFrame(() => {
        const heading = document.getElementById(`column-${result.createdId}`);
        heading?.focus({ preventScroll: true });
        heading?.closest('section')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    } finally { busy.current = false; setMoving(false); }
  }
  async function updateLayout(path: string, method: 'PATCH' | 'POST', change: TaskColorChange | TaskListMove) {
    if (!board || busy.current || readOnly || loading || error) return;
    busy.current = true; setMoving(true); setNotice('');
    try {
      setBoard(await taskRequest<Board>(path, method, {...change, revision: board.revision}));
    } catch (reason) {
      setError(`${reason instanceof Error ? reason.message : 'Could not save layout.'} Refresh the board before trying again.`);
    } finally { busy.current = false; setMoving(false); }
  }
  const changeColor = (change: TaskColorChange) => updateLayout('/api/tasks/appearance', 'PATCH', change);
  const moveList = (change: TaskListMove) => updateLayout('/api/tasks/lists/move', 'POST', change);
  async function removeList(listId: number) {
    if (!board || busy.current || readOnly || loading || error) throw new Error('Wait for the current operation to finish.');
    busy.current = true; setMoving(true); setNotice('');
    try {
      setBoard(await taskRequest<Board>(`/api/tasks/lists/${listId}`, 'DELETE', { revision: board.revision }));
      setNotice('List removed.');
    } finally { busy.current = false; setMoving(false); }
  }
  const disabled = loading || moving || readOnly || !!error;
  const pageHeader = <div className="flex w-max items-center gap-1 font-sans text-sm">
    <div role="group" aria-label="Board scope" className="inline-flex rounded-lg bg-stone-100 p-1">
      {(['school', 'personal'] as const).map(scope => <button key={scope} type="button" aria-pressed={boardScope === scope} disabled={disabled || dragging} onClick={() => void chooseBoard(scope)} className={`min-h-10 rounded-md px-3 font-semibold transition-colors disabled:opacity-50 ${boardScope === scope ? 'bg-slate-800 text-white shadow-sm' : 'hover:bg-white'}`}>{scope === 'school' ? 'School' : 'Personal'}</button>)}
    </div>
    <TaskSettings label="Board settings" color={activeBoard?.color} disabled={disabled || dragging} onColor={color => changeColor({target: 'board', scope: boardScope, color})} />
    <button type="button" aria-label="Refresh tasks" title="Refresh tasks" disabled={loading || moving || dragging} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-stone-100 disabled:opacity-50" onClick={() => void load()}>
      <svg aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0 2 5.3M20 4v7h-7" /></svg><span className="sr-only">Refresh</span>
    </button>
  </div>;
  return <main style={{ background: taskBackground(activeBoard?.color, '#e7e5e4') }} className="min-h-0 min-w-0 flex-1 overflow-hidden !p-0 text-slate-800">
    {error && <p role="alert" className="m-2 rounded-lg bg-red-50 p-3 font-sans text-sm text-red-700">{error}<button className="ml-2 min-h-11 underline" disabled={loading || moving} onClick={() => void load()}>Refresh</button></p>}
    {loading && <p role="status" className="px-4 font-sans text-sm">Loading tasks…</p>}
    {headerTarget && createPortal(pageHeader, headerTarget)}
    <p id="task-board-summary" tabIndex={-1} role="status" className="sr-only">{visible.length} tasks shown. Inbox and Personal are private. School is shared.</p>
    {board && <TaskDragBoard onColor={changeColor} onListMove={moveList} onRemoveList={removeList} boardScope={boardScope} board={board} columns={lists} onCreate={createCard} onAddList={createList} visible={visible} today={today} disabled={disabled} onDragging={setDragging} onStudent={setStudentId} onMove={move} onEdit={task => setEditor({ task })} />}
    {editor && board && <TaskPanel listId={editor.listId} task={editor.task} board={board} studentId={filters.studentId} onClose={() => { setEditor(null); void load(); }} onSaved={async message => { setNotice(message); await load(); setEditor(null); }} />}
    {studentId !== null && <StudentPanel id={studentId} onClose={() => { setStudentId(null); void load(); }} onUpdate={() => void load()} onDelete={() => { setStudentId(null); void load(); }} />}
    <OperationNotification message={notice} onDismiss={() => setNotice('')} />
  </main>;
}
