"use client";

import { useCallback, useEffect, useState } from 'react';
import type { TaskBoard } from '../lib/tasks';
import { taskRequest } from '../lib/tasks-client';

export default function StudentTasks({ studentId }: { studentId: number }) {
  const [allowed, setAllowed] = useState(false);
  const [board, setBoard] = useState<TaskBoard | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setBoard(await taskRequest<TaskBoard>(`/api/tasks?studentId=${studentId}`)); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load linked tasks.'); }
  }, [studentId]);
  useEffect(() => {
    let cancelled = false;
    taskRequest<{ tasks: boolean }>('/api/access-permissions').then(permissions => {
      if (!cancelled && permissions.tasks) { setAllowed(true); void load(); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [load]);
  if (!allowed) return null;
  const tasks = board?.tasks.filter(task => (task.status ?? 'in_progress') !== 'done') ?? [];
  const button = 'min-h-11 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold disabled:opacity-50';
  return <section aria-label="Linked tasks" className="mt-4 rounded-xl border border-stone-200 bg-white p-4 font-sans text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="m-0 font-serif text-lg font-normal">Linked tasks</h2><a className="inline-flex min-h-11 items-center text-lime-800 underline" href={`/tasks?studentId=${studentId}`}>Open tasks board</a></div>
    <p className="text-xs text-slate-500">Active tasks linked to this student. Select a task to find it on the board.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!board && !error && <p role="status">Loading linked tasks…</p>}
    {board && tasks.length === 0 && <p role="status">No active linked tasks.</p>}
    <ul className="m-0 list-none divide-y divide-stone-200 p-0">{tasks.map(task => <li key={task.key}>
      <a className="block break-words rounded-md py-3 text-lime-800 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-lime-600" href={`/tasks?highlight=${encodeURIComponent(task.key)}`}>{task.title}</a>
    </li>)}</ul>
    <button type="button" className={button} onClick={() => void load()}>Refresh linked tasks</button>
  </section>;
}
