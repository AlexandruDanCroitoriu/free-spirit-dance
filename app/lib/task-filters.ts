import { type BoardTask } from './tasks';
import { addCalendarDays } from './calendar-dates';

export const dueFilters = [['all', 'All dates'], ['overdue', 'Overdue'], ['today', 'Due today'], ['7', 'Next 7 days'], ['30', 'Next 30 days']] as const;
export type TaskFilters = { status?: 'all' | 'none' | 'in_progress' | 'done'; view: string; due: typeof dueFilters[number][0]; studentId: number | null };
export function readTaskFilters(params: URLSearchParams, views = ['all', 'manual']): TaskFilters {
  const student = Number(params.get('studentId'));
  return {
    status: params.get('status') === 'none' ? 'none' : params.get('status') === 'done' ? 'done' : params.get('status') === 'in_progress' ? 'in_progress' : 'all',
    view: views.includes(params.get('view') ?? '') ? params.get('view')! : 'all',
    due: dueFilters.find(([value]) => value === params.get('due'))?.[0] ?? 'all',
    studentId: Number.isSafeInteger(student) && student > 0 ? student : null,
  };
}
export function writeTaskFilters(filters: TaskFilters, params = new URLSearchParams()) {
  for (const key of ['dismissed', 'status', 'completed']) params.delete(key);
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === 'all') params.delete(key);
    else params.set(key, String(value));
  }
  return params;
}
export function matchesTask(task: BoardTask, filters: TaskFilters, today: string) {
  if (filters.status && filters.status !== 'all' && (task.status ?? 'in_progress') !== filters.status) return false;
  if ((filters.view === 'manual' && task.source !== 'manual') || (filters.view !== 'all' && filters.view !== 'manual' && task.category !== filters.view) || (filters.studentId !== null && !task.students.some(student => student.id === filters.studentId))) return false;
  if (filters.due === 'all') return true;
  if (!task.dueDate) return false;
  if (filters.due === 'overdue') return task.dueDate < today;
  if (filters.due === 'today') return task.dueDate === today;
  return task.dueDate >= today && task.dueDate <= addCalendarDays(today, Number(filters.due));
}
export function formatTaskDate(date: string) {
  return new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
