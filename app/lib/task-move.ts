import type { TaskStatus } from './tasks';

export type TaskMove = { key: string; status: TaskStatus; position: 'before' | 'after' | 'top' | 'bottom'; targetKey?: string };
export type TaskOrder = Partial<Record<TaskStatus, string[]>>;

// Translate a visible drag preview into the same relative move used by buttons.
// Never submit filtered columns as replacement lists: hidden tasks keep their order.
export function taskMoveFromOrder(key: string, before: TaskOrder, after: TaskOrder): TaskMove | null {
  const statuses = Object.keys(before) as TaskStatus[];
  const origin = statuses.find(status => before[status]?.includes(key));
  const destination = statuses.find(status => after[status]?.includes(key));
  if (!origin || !destination) return null;
  const list = after[destination]!;
  const index = list.indexOf(key);
  if (origin === destination && before[origin]!.indexOf(key) === index) return null;
  const next = list[index + 1], previous = list[index - 1];
  if (next) return { key, status: destination, position: 'before', targetKey: next };
  if (previous) return { key, status: destination, position: 'after', targetKey: previous };
  return { key, status: destination, position: 'bottom' };
}
