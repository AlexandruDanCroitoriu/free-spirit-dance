"use client";

import { dueFilters, type TaskFilters } from '../lib/task-filters';
import type { TaskBoard } from '../lib/tasks';

export default function TaskFiltersBar({ value, views = [{ key: 'all', title: 'All tasks' }, { key: 'manual', title: 'Manual tasks' }], students, onChange }: {
  value: TaskFilters; views?: TaskBoard['views']; students: { id: number; name: string }[]; onChange: (filters: TaskFilters) => void;
}) {
  const field = 'mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm';
  return <section aria-label="Task filters" className="mb-5 rounded-xl border border-stone-200 bg-white p-4 font-sans">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs font-semibold">View<select className={field} value={value.view} onChange={event => onChange({ ...value, view: event.target.value })}>{views.map(view => <option key={view.key} value={view.key}>{view.title}</option>)}</select></label>
      <label className="text-xs font-semibold">Due date<select className={field} value={value.due} onChange={event => onChange({ ...value, due: event.target.value as TaskFilters['due'] })}>{dueFilters.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold">Linked student<select className={field} value={value.studentId ?? ''} onChange={event => onChange({ ...value, studentId: event.target.value ? Number(event.target.value) : null })}><option value="">All students</option>{value.studentId !== null && !students.some(student => student.id === value.studentId) && <option value={value.studentId}>Student #{value.studentId}</option>}{students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
    </div>
    <p className="m-0 mt-2 text-xs text-slate-500">Dates use school time (Bucharest).</p>
  </section>;
}
