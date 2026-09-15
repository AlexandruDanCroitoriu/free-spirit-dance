"use client";

import { formatTaskDate } from '../lib/task-filters';
import type { BoardTask, TaskBoard, TaskStatus } from '../lib/tasks';
import { useState, type ReactNode } from 'react';
import type { TaskMove } from '../lib/task-move';

export type AutomaticAction = 'dismiss' | 'restore' | 'unlink';
export default function TaskCard({ task, columns, today, previous, next, canTop, canBottom, disabled, dragHandle, categoryTitle, onAction, onEdit, onStudent, onMove }: {
  task: BoardTask; columns: TaskBoard['columns']; today: string; previous?: string; next?: string; canTop: boolean; canBottom: boolean; disabled: boolean;
  dragHandle?: ReactNode;
  categoryTitle?: string; onAction?: (action: AutomaticAction) => void;
  onEdit: () => void; onStudent: (id: number) => void; onMove: (move: TaskMove) => void;
}) {
  const [unlinking, setUnlinking] = useState(false);
  const button = 'min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold hover:bg-stone-50 disabled:opacity-40';
  const overdue = !task.dismissed && task.status !== 'done' && task.dueDate !== null && task.dueDate < today;
  return <article aria-label={task.title} className="min-w-0 rounded-xl border border-stone-200 bg-white p-4 shadow-sm font-sans">
    {task.source === 'automatic' && <p className="mb-2 mt-0 text-xs font-semibold text-lime-800">Automatic · {categoryTitle ?? task.category}{task.dismissed && ' · Dismissed'}</p>}
    <div className="flex items-start justify-between gap-2">{dragHandle}<h3 className="m-0 min-w-0 flex-1 break-words text-sm font-bold">{task.title}</h3>{task.canEditContent && <button type="button" disabled={disabled} className={button} aria-label={`Edit ${task.title}`} onClick={onEdit}>Edit</button>}</div>
    {task.description && <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-slate-600">{task.description}</p>}
    <p className={`text-xs ${overdue ? 'font-semibold text-red-700' : 'text-slate-500'}`}>{task.dueDate ? <><time dateTime={task.dueDate}>{formatTaskDate(task.dueDate)}</time>{overdue ? ' · Overdue' : task.dueDate === today ? ' · Today' : ''}</> : 'No due date'}{task.status === 'done' && ' · Completed'}</p>
    {task.student && <a aria-disabled={disabled || undefined} className="mb-2 inline-flex min-h-11 items-center break-words text-sm font-semibold text-lime-800 underline" href={`/students?student=${task.student.id}`} onClick={event => { if (disabled) { event.preventDefault(); return; } if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onStudent(task.student!.id); } }}>{task.student.name}</a>}
    <label className="block text-xs font-semibold">Move to<select aria-label={`Status for ${task.title}`} className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-2 text-sm disabled:opacity-50" disabled={disabled} value={task.status} onChange={event => onMove({ key: task.key, status: event.target.value as TaskStatus, position: 'bottom' })}>{columns.map(column => <option key={column.status} value={column.status}>{column.title}</option>)}</select></label>
    <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label={`Position of ${task.title}`}>
      <button type="button" className={button} disabled={disabled || !previous} onClick={() => onMove({ key: task.key, status: task.status, position: 'before', targetKey: previous })}>Move up</button>
      <button type="button" className={button} disabled={disabled || !next} onClick={() => onMove({ key: task.key, status: task.status, position: 'after', targetKey: next })}>Move down</button>
      <button type="button" className={button} disabled={disabled || !canTop} onClick={() => onMove({ key: task.key, status: task.status, position: 'top' })}>Move to top</button>
      <button type="button" className={button} disabled={disabled || !canBottom} onClick={() => onMove({ key: task.key, status: task.status, position: 'bottom' })}>Move to bottom</button>
    </div>
    {task.source === 'automatic' && onAction && <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled} onClick={() => onAction(task.dismissed ? 'restore' : 'dismiss')}>{task.dismissed ? 'Restore occurrence' : 'Dismiss occurrence'}</button>{task.student && !unlinking && <button type="button" className={button} disabled={disabled} onClick={() => setUnlinking(true)}>Remove student link</button>}{task.student && unlinking && <div className="w-full rounded-lg bg-stone-100 p-3 text-xs"><p>Remove this occurrence’s student link? The task and its occurrence state will be kept.</p><button type="button" className={button} disabled={disabled} onClick={() => setUnlinking(false)}>Keep link</button><button type="button" className={`${button} ml-2`} disabled={disabled} onClick={() => { setUnlinking(false); onAction('unlink'); }}>Confirm unlink</button></div>}</div>}
  </article>;
}
