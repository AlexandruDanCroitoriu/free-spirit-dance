import { taskStatuses, type BoardTask, type TaskStatus } from './tasks';
import { addCalendarDays } from './task-dates';

export const dueFilters = [['all', 'All dates'], ['overdue', 'Overdue'], ['today', 'Due today'], ['7', 'Next 7 days'], ['30', 'Next 30 days']] as const;
export type TaskFilters = { view: string; due: typeof dueFilters[number][0]; status: 'all' | TaskStatus; completed: boolean; dismissed: boolean; studentId: number | null };
export function readTaskFilters(params: URLSearchParams, views = ['all', 'manual', 'birthday']): TaskFilters {
  const student = Number(params.get('studentId'));
  return {
    view: views.includes(params.get('view') ?? '') ? params.get('view')! : 'all',
    due: dueFilters.find(([value]) => value === params.get('due'))?.[0] ?? 'all',
    status: taskStatuses.find(value => value === params.get('status')) ?? 'all',
    completed: params.get('completed') !== '0',
    dismissed: params.get('dismissed') === '1',
    studentId: Number.isSafeInteger(student) && student > 0 ? student : null,
  };
}
export function writeTaskFilters(filters: TaskFilters, params = new URLSearchParams()) {
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === 'all' || (key === 'completed' && value === true) || (key === 'dismissed' && !value)) params.delete(key);
    else params.set(key, key === 'completed' ? '0' : key === 'dismissed' ? '1' : String(value));
  }
  return params;
}
export function matchesTask(task: BoardTask, filters: TaskFilters, today: string) {
  if ((task.dismissed && !filters.dismissed) || (filters.view === 'manual' && task.source !== 'manual') || (filters.view !== 'all' && filters.view !== 'manual' && task.category !== filters.view) || (!filters.completed && task.status === 'done') || (filters.status !== 'all' && task.status !== filters.status) || (filters.studentId !== null && task.student?.id !== filters.studentId)) return false;
  if (filters.due === 'all') return true;
  if (!task.dueDate) return false;
  if (filters.due === 'overdue') return !task.dismissed && task.status !== 'done' && task.dueDate < today;
  if (filters.due === 'today') return task.dueDate === today;
  return task.dueDate >= today && task.dueDate <= addCalendarDays(today, Number(filters.due));
}
export function formatTaskDate(date: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
