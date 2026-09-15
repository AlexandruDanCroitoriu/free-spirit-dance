export const taskStatuses = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = typeof taskStatuses[number];
export const taskColumns = taskStatuses.map((status, index) => ({ status, title: ['Todo', 'In Progress', 'Done'][index] }));

// Both sources share this contract; rule-specific behavior stays in the registry.
export type BoardTask = {
  key: string;
  source: 'manual' | 'automatic';
  category: string;
  title: string;
  description: string;
  dueDate: string | null;
  status: TaskStatus;
  student: { id: number; name: string } | null;
  sortOrder: number;
  dismissed: boolean;
  canEditContent: boolean;
  canDelete: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
};
export type TaskBoard = { tasks: BoardTask[]; revision: number; today: string; columns: typeof taskColumns; views?: { key: string; title: string }[] };
export type ManualTaskFields = { title: string; description: string; dueDate: string | null; status: TaskStatus; studentId: number | null };

export class TaskError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function taskStatus(value: unknown): TaskStatus {
  if (!taskStatuses.includes(value as TaskStatus)) throw new TaskError('Choose Todo, In Progress, or Done.');
  return value as TaskStatus;
}

export function taskRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) throw new TaskError('A valid board revision is required.');
  return value;
}

export function manualTaskId(key: string): number {
  if (!/^manual:[1-9]\d*$/.test(key)) throw new TaskError('Invalid manual task key.');
  const id = Number(key.slice(7));
  if (!Number.isSafeInteger(id)) throw new TaskError('Invalid manual task key.');
  return id;
}

function taskText(value: unknown, max: number, required = false) {
  if (typeof value !== 'string' || value.includes('\0') || value.trim().length > max || (required && !value.trim())) throw new TaskError(`Enter ${required ? 'a value of ' : ''}up to ${max} characters.`);
  return value.trim();
}

function dueDate(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') throw new TaskError('Enter a valid due date or leave it empty.');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new TaskError('Enter a valid due date or leave it empty.');
  return value;
}

export function manualTaskFields(input: Record<string, unknown>, previous?: ManualTaskFields): ManualTaskFields {
  const merged = { description: '', dueDate: null, status: 'todo', studentId: null, ...previous, ...input };
  const studentId = merged.studentId;
  if (studentId !== null && (typeof studentId !== 'number' || !Number.isSafeInteger(studentId) || studentId < 1)) throw new TaskError('Choose a valid student or remove the student link.');
  return { title: taskText(merged.title, 200, true), description: taskText(merged.description, 10000), dueDate: dueDate(merged.dueDate), status: taskStatus(merged.status), studentId };
}

export function schoolToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
