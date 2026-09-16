"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskBoard } from '../lib/tasks';
import { taskRequest } from '../lib/tasks-client';

export default function StudentTasks({ studentId }: { studentId: number }) {
  const [allowed, setAllowed] = useState(false);
  const [board, setBoard] = useState<TaskBoard | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
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
  async function unlink(key: string) {
    if (!board || busy.current) return;
    busy.current = true; setSaving(true);
    try {
      const result = await taskRequest<{ revision: number }>(`/api/tasks/${encodeURIComponent(key)}`, 'PATCH', { studentIds: board!.tasks.find(task => task.key === key)!.students.filter(student => student.id !== studentId).map(student => student.id), revision: board.revision });
      setBoard({ ...board, revision: result.revision, tasks: board.tasks.filter(task => task.key !== key) }); setConfirm(null); setError('');
    } catch (reason) { setError(`${reason instanceof Error ? reason.message : 'Could not remove link.'} Refresh linked tasks before trying again.`); }
    finally { busy.current = false; setSaving(false); }
  }
  if (!allowed) return null;
  const button = 'min-h-11 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold disabled:opacity-50';
  return <section aria-label="Linked tasks" className="mt-4 rounded-xl border border-stone-200 bg-white p-4 font-sans text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="m-0 font-serif text-lg font-normal">Linked tasks</h2><a className="inline-flex min-h-11 items-center text-lime-800 underline" href={`/tasks?studentId=${studentId}`}>Open tasks board</a></div>
    <p className="text-xs text-slate-500">Linked tasks, including personal tasks, prevent student deletion. You can see School tasks and your own Personal and Inbox tasks here. Each task owner must remove their private links first.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!board && !error && <p role="status">Loading linked tasks…</p>}
    {board?.tasks.length === 0 && <p role="status">No linked tasks.</p>}
    <ul className="m-0 list-none divide-y divide-stone-200 p-0">{board?.tasks.map(task => <li key={task.key} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words"><a className="text-lime-800 underline" href={`/tasks?scope=${board.boards.find(item => item.id === board.lists.find(list => list.id === task.listId)?.boardId)?.scope ?? 'school'}&studentId=${studentId}`}>{task.title}</a></span>{confirm !== task.key && <button type="button" className={button} disabled={saving || !!error} onClick={() => setConfirm(task.key)}>Remove link<span className="sr-only"> from {task.title}</span></button>}</div>{confirm === task.key && <div className="mt-2 rounded-lg bg-stone-100 p-3"><p>Remove this student relationship? The task will be kept.</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={saving} onClick={() => setConfirm(null)}>Keep link</button><button type="button" className={button} disabled={saving || !!error} onClick={() => void unlink(task.key)}>{saving ? 'Removing…' : 'Confirm remove link'}</button></div></div>}</li>)}</ul>
    <button type="button" className={button} disabled={saving} onClick={() => { setConfirm(null); void load(); }}>Refresh linked tasks</button>
  </section>;
}
