"use client";

import { formatTaskDate } from '../lib/task-filters';
import type { BoardTask } from '../lib/tasks';

export type TaskCardAdministrator = { email: string; name: string; picture: string | null };

export default function TaskCard({ task, administrator, today, disabled, onStudent, onEdit }: {
  task: BoardTask;
  administrator?: TaskCardAdministrator;
  today: string; disabled: boolean;
  onStudent: (id: number) => void; onEdit: (task: BoardTask) => void;
}) {
  const overdue = task.status !== 'done' && task.dueDate !== null && task.dueDate < today;
  const assigneeName = administrator?.name || task.assignedTo;
  const assigneePicture = administrator?.picture;
  return <article onClick={event => { if (!disabled && event.target instanceof Element && !event.target.closest('button, a, details, input, select, textarea')) onEdit(task); }} aria-label={task.title} className="relative rounded-lg border border-stone-200 bg-white p-2 font-sans shadow-sm">
    <div className="flex items-center gap-2"><button data-task-open type="button" disabled={disabled} onClick={() => onEdit(task)} className="min-h-11 min-w-0 flex-1 break-words rounded-md px-1 text-left text-sm hover:bg-stone-50 disabled:opacity-70">{task.title}</button>
      {task.assignedTo && assigneeName && <span role="img" aria-label={`Assigned administrator: ${assigneeName}`} title={`Assigned administrator: ${assigneeName}`} className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-purple-200 text-xs font-bold text-purple-950 ring-2 ring-purple-100">
        {assigneePicture && /^\/(?!\/)/.test(assigneePicture) ? <img src={assigneePicture} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" /> : assigneeName.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()}
      </span>}
    </div>
    <span className={`mx-1 mb-1 inline-block rounded-full px-2 py-0.5 text-xs ${task.status === 'done' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>{task.status === 'done' ? 'Done' : 'In progress'}</span>
    {(task.dueDate || task.students.length > 0) && <div className="flex items-end justify-between gap-2 px-1">
      <div className="flex min-w-0 flex-wrap">{task.students.map(student => <a key={student.id} aria-label={`Open student: ${student.name}`} title={student.name} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-lime-700" href={`/students?student=${student.id}`} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onStudent(student.id); } }}><span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-lime-200 text-xs font-bold text-slate-800">{student.picture ? <img src={student.picture} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" /> : student.name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('')}</span></a>)}</div>
      {task.dueDate && <time dateTime={task.dueDate} aria-label={`${overdue ? 'Overdue: ' : 'Due: '}${formatTaskDate(task.dueDate)}`} className={`mb-1 shrink-0 text-right text-xs ${overdue ? 'text-red-700' : 'text-slate-500'}`}>{formatTaskDate(task.dueDate)}</time>}
    </div>}
  </article>;
}
