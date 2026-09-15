"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { matchesTask, readTaskFilters, writeTaskFilters, type TaskFilters } from '../lib/task-filters';
import { schoolToday, type BoardTask, type TaskBoard as Board } from '../lib/tasks';
import { taskRequest, TaskRequestError } from '../lib/tasks-client';
import TaskFiltersBar from './task-filters';
import TaskDragBoard from './task-drag-board';
import type { TaskMove } from '../lib/task-move';
import TaskPanel from './task-panel';
import type { AutomaticAction } from './task-card';
import StudentPanel from './student-panel';
import OperationNotification from './operation-notification';

export default function TaskBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [filters, setFilters] = useState(() => readTaskFilters(new URLSearchParams()));
  const [today, setToday] = useState(schoolToday);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [moving, setMoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [editor, setEditor] = useState<{ task: BoardTask | null } | null>(null);
  const [studentId, setStudentId] = useState<number | null>(null);
  const busy = useRef(false);
  const loadSequence = useRef(0);
  const load = useCallback(async (synchronize = true) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setError('');
    try {
      const storage = await taskRequest<{ readOnly?: boolean }>('/api/production-database');
      const data = synchronize && !storage.readOnly ? await taskRequest<Board>('/api/tasks/refresh', 'POST', {}) : await taskRequest<Board>('/api/tasks');
      if (sequence === loadSequence.current) { setReadOnly(!!storage.readOnly); setBoard(data); setToday(data.today); }
    }
    catch (reason) { if (sequence === loadSequence.current) setError(reason instanceof Error ? reason.message : 'Could not load tasks.'); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const viewKeys = board?.views?.map(view => view.key).join('|');
  useEffect(() => {
    const restore = () => setFilters(readTaskFilters(new URLSearchParams(window.location.search), viewKeys?.split('|')));
    restore(); window.addEventListener('popstate', restore);
    const timer = window.setInterval(() => setToday(schoolToday()), 60_000);
    return () => { window.removeEventListener('popstate', restore); window.clearInterval(timer); };
  }, [viewKeys]);
  useEffect(() => {
    if (board && board.today !== today && !moving && !dragging && !editor && studentId === null) void load();
  }, [today, board, moving, dragging, editor, studentId, load]);
  function changeFilters(next: TaskFilters) {
    setFilters(next);
    const url = new URL(window.location.href);
    url.search = writeTaskFilters(next, url.searchParams).toString();
    window.history.pushState(null, '', url);
  }
  async function move(change: TaskMove) {
    if (!board || busy.current || readOnly || loading || error) return;
    busy.current = true; setMoving(true); setNotice(''); setError('');
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      const updated = await taskRequest<Board>('/api/tasks/move', 'POST', { ...change, revision: board.revision });
      setBoard(updated);
      const title = board.tasks.find(task => task.key === change.key)?.title ?? 'Task';
      setNotice(`${title} moved. The shared order has been saved.`);
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
  async function automaticAction(task: BoardTask, action: AutomaticAction) {
    if (!board || busy.current || readOnly || loading || error) return;
    busy.current = true; setMoving(true); setError('');
    try {
      const result = await taskRequest<{ task: BoardTask; revision: number }>(`/api/tasks/${encodeURIComponent(task.key)}`, 'PATCH', { revision: board.revision, ...(action === 'unlink' ? { studentId: null } : { dismissed: action === 'dismiss' }) });
      setBoard({ ...board, revision: result.revision, tasks: board.tasks.map(item => item.key === task.key ? result.task : item) });
      setNotice(action === 'unlink' ? 'Student link removed.' : action === 'dismiss' ? 'Occurrence dismissed. Use Include dismissed tasks to restore it.' : 'Occurrence restored.');
    } catch (reason) { setError(`${reason instanceof Error ? reason.message : 'Could not update occurrence.'} Refresh before trying again.`); }
    finally { busy.current = false; setMoving(false); window.requestAnimationFrame(() => document.getElementById('task-board-summary')?.focus()); }
  }
  const visible = board?.tasks.filter(task => matchesTask(task, filters, today)) ?? [];
  const students = Array.from(new Map(board?.tasks.flatMap(task => task.student ? [[task.student.id, task.student] as const] : [])).values()).sort((a, b) => a.name.localeCompare(b.name));
  const disabled = loading || moving || readOnly || !!error;
  return <main className="min-w-0 flex-1 px-4 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="m-0 font-sans text-sm text-slate-600">A shared board for school tasks.</p><div className="flex gap-2"><button type="button" disabled={loading || moving || dragging} onClick={() => void load()} className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 font-sans text-sm disabled:opacity-50">Refresh</button><button type="button" disabled={!board || disabled || dragging} onClick={() => setEditor({ task: null })} className="min-h-11 rounded-lg bg-slate-800 px-4 font-sans text-sm font-bold text-white disabled:opacity-50">+ Create task</button></div></div>
    {board && <fieldset disabled={dragging || moving} className="m-0 min-w-0 border-0 p-0"><legend className="sr-only">Task filters</legend><TaskFiltersBar value={filters} columns={board.columns} views={board.views} students={students} onChange={changeFilters} /></fieldset>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-sm text-red-700">{error}</p>}
    {loading && <p role="status" className="font-sans text-sm text-slate-500">Loading tasks…</p>}
    {board && <><p id="task-board-summary" tabIndex={-1} role="status" className="font-sans text-sm text-slate-500">{visible.length} {visible.length === 1 ? 'task' : 'tasks'} shown{board.tasks.length === 0 ? '. Create your first task to get started.' : visible.length === 0 ? '. No tasks match these filters.' : '.'}</p><p className="font-sans text-xs text-slate-500">Move up/down relative to visible tasks. Top/bottom uses the whole column, including hidden tasks.</p>
      <p id="task-drag-help" className="font-sans text-xs text-slate-500">Drag using a task's handle. On touch screens, hold the handle briefly; scroll from the rest of the card. Movement controls are always available.</p>
      <TaskDragBoard key={JSON.stringify(filters)} board={board} columns={board.columns.filter(column => (filters.status === 'all' || filters.status === column.status) && (filters.completed || column.status !== 'done'))} visible={visible} today={today} disabled={disabled} onDragging={setDragging} onEdit={task => setEditor({ task })} onStudent={setStudentId} onMove={move} onAction={(task, action) => void automaticAction(task, action)} /></>}
    {editor && board && <TaskPanel task={editor.task} board={board} studentId={filters.studentId} onClose={() => setEditor(null)} onSaved={async message => { setNotice(message); await load(false); setEditor(null); }} />}
    {studentId !== null && <StudentPanel id={studentId} onClose={() => { setStudentId(null); void load(); }} onUpdate={() => void load()} onDelete={() => { setStudentId(null); void load(); }} />}
    <OperationNotification message={notice} onDismiss={() => setNotice('')} />
  </div></main>;
}
