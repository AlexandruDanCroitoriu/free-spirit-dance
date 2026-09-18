"use client";

import { useEffect, useRef, useState } from 'react';
import { schoolToday } from '../lib/calendar-dates';
import { formatTaskDate } from '../lib/task-filters';
import { taskRequest } from '../lib/tasks-client';

type TaskStatus = 'in_progress' | 'blocked' | 'done';
type Notification = { id: number; title: string; status: TaskStatus; dueDate: string | null; listName: string; scope: 'school' | 'personal' };
const statuses: { value: TaskStatus; label: string }[] = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
];

export default function TaskNotifications() {
  const [tasks, setTasks] = useState<Notification[]>([]);
  const [status, setStatus] = useState<TaskStatus>('in_progress');
  const today = schoolToday();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const dropdown = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let cancelled = false, refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState !== 'visible') return;
      refreshing = true;
      try {
        const result = await taskRequest<Notification[]>('/api/tasks/notifications');
        if (!cancelled) { setTasks(result); setError(false); }
      } catch { if (!cancelled) setError(true); }
      finally { refreshing = false; if (!cancelled) setLoaded(true); }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !dropdown.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const visibleTasks = tasks.filter(task => task.status === status);
  return <div ref={dropdown} className="relative shrink-0 font-sans" onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" aria-label={error ? 'Could not load assigned task notifications' : `Assigned task notifications${loaded ? ` (${tasks.length})` : ''}`} aria-expanded={open} aria-controls="task-notifications" onClick={() => setOpen(value => !value)} className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-slate-700 hover:bg-stone-50 focus-visible:outline-lime-600">
      <svg aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {loaded && !error && tasks.length > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-purple-700 px-1 text-[10px] font-bold text-white">{tasks.length > 99 ? '99+' : tasks.length}</span>}
    </button>
    {open && <div id="task-notifications" role="dialog" aria-label="Assigned tasks" className="fixed left-3 right-3 top-16 z-40 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
      <div className="border-b border-stone-200 px-4 py-3"><h2 className="m-0 text-sm font-semibold text-slate-800">Assigned to you</h2><p className="m-0 mt-0.5 text-xs text-slate-500">School and Personal · Most urgent first</p><div role="group" aria-label="Filter assigned tasks by status" className="mt-3 inline-flex w-full gap-1 rounded-lg border border-stone-300 bg-stone-50 p-1">{statuses.map(item => <button key={item.value} type="button" aria-pressed={status === item.value} onClick={() => setStatus(item.value)} className={`min-h-9 flex-1 rounded-md px-2 text-xs font-semibold transition-colors ${status === item.value ? 'bg-blue-400 text-slate-950' : 'text-slate-600 hover:bg-stone-200'}`}>{item.label}</button>)}</div></div>
      {error ? <p role="alert" className="m-0 p-4 text-sm text-red-700">Could not load assigned tasks.</p> : !loaded ? <p role="status" className="m-0 p-4 text-sm text-slate-500">Loading tasks…</p> : !visibleTasks.length ? <p className="m-0 p-4 text-sm text-slate-500">No {statuses.find(item => item.value === status)?.label.toLowerCase()} School or Personal tasks assigned to you.</p> : <ul className="m-0 max-h-72 list-none divide-y divide-stone-100 overflow-y-auto p-0">{visibleTasks.map(task => <li key={task.id}><a href={`/tasks?task=${encodeURIComponent(`manual:${task.id}`)}`} onClick={() => { try { window.localStorage.setItem('fsd-task-board-scope', task.scope); } catch {} }} className="block px-4 py-3 text-sm hover:bg-stone-50 focus-visible:outline-lime-600"><span className="block break-words font-medium text-slate-800">{task.title}</span><span className="mt-1 flex justify-between gap-3 text-xs text-slate-500"><span>{task.scope === 'school' ? 'School' : 'Personal'} · {task.listName}</span>{task.dueDate ? <time dateTime={task.dueDate} className={task.dueDate < today ? 'font-semibold text-red-700' : task.dueDate === today ? 'font-semibold text-orange-700' : ''}>{task.dueDate < today ? 'Overdue · ' : task.dueDate === today ? 'Today · ' : 'Due · '}{formatTaskDate(task.dueDate)}</time> : <span>No due date</span>}</span></a></li>)}</ul>}
    </div>}
  </div>;
}
