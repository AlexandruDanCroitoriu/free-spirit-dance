import type { TaskColor } from './task-colors';
import { descriptionLinks } from './task-description';
export type TaskStudent = { id: number; name: string; picture: string | null };
export type TaskEvent = { id: number; name: string; imagePath?: string | null };
export type TaskMeeting = { id: number; eventId: number; name: string; eventName: string };

export type BoardTask = {
  status: 'in_progress' | 'blocked' | 'done';
  key: string;
  listId: number | null;
  source: 'manual';
  category: string;
  title: string;
  description: string;
  dueDate: string | null;
  students: TaskStudent[];
  courses: { id: number; name: string }[];
  events: TaskEvent[];
  meetings: TaskMeeting[];
  sortOrder: number;
  canDelete: boolean;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  administratorEmails?: string[];
  assignedTo?: string | null;
};
export type NamedTaskBoard = { id: number; name: string; scope: 'school' | 'personal'; color: TaskColor };
export type TaskList = { id: number; boardId: number; title: string; sortOrder: number; color: TaskColor };
export type TaskBoard = { inboxColor: TaskColor; selectedBoardScope: 'school' | 'personal'; tasks: BoardTask[]; boards: NamedTaskBoard[]; lists: TaskList[]; revision: number; today: string; views?: { key: string; title: string }[] };
export type ManualTaskFields = { status?: 'in_progress' | 'blocked' | 'done'; title: string; description: string; dueDate: string | null; studentIds: number[]; courseIds: number[]; eventIds?: number[]; meetingIds?: number[]; administratorEmails?: string[]; assignedTo?: string | null };

// A move depends only on its card and the source/destination lists. Private
// activity elsewhere must not invalidate this view of their order.
export function taskMoveState(board: Pick<TaskBoard, 'tasks' | 'lists'>, key: string, destination?: number | null): string {
  const task = board.tasks.find(item => item.key === key);
  const ids = [task?.listId ?? null, destination === undefined ? task?.listId ?? null : destination];
  return JSON.stringify({
    task: task ?? null,
    lists: board.lists.filter(list => ids.includes(list.id)).sort((a, b) => a.id - b.id),
    order: board.tasks.filter(item => ids.includes(item.listId)).map(item => ({ key: item.key, listId: item.listId, sortOrder: item.sortOrder })).sort((a, b) => a.key.localeCompare(b.key)),
  });
}

export class TaskError extends Error {
  constructor(message: string, public status = 400) { super(message); }
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
  const merged = { description: '', dueDate: null, studentIds: [], courseIds: [], eventIds: [], meetingIds: [], ...previous, ...input };
  const status = input.status === undefined ? previous?.status ?? 'in_progress' : input.status;
  if (status !== 'in_progress' && status !== 'blocked' && status !== 'done') throw new TaskError('Choose In progress, Blocked, or Done.');
  if (!Array.isArray(merged.studentIds) || merged.studentIds.length > 500 || merged.studentIds.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)) throw new TaskError('Choose valid students (up to 500 per task).');
  if (!Array.isArray(merged.courseIds) || merged.courseIds.length > 500 || merged.courseIds.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)) throw new TaskError('Choose valid courses (up to 500 per task).');
  if (!Array.isArray(merged.eventIds) || merged.eventIds.length > 500 || merged.eventIds.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)) throw new TaskError('Choose valid events (up to 500 per task).');
  if (!Array.isArray(merged.meetingIds) || merged.meetingIds.length > 500 || merged.meetingIds.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)) throw new TaskError('Choose valid meetings (up to 500 per task).');
  const description = taskText(merged.description, 10000), links = descriptionLinks(description);
  const emails = input.administratorEmails ?? previous?.administratorEmails ?? [];
  const assignedTo = input.assignedTo === undefined ? previous?.assignedTo ?? null : input.assignedTo;
  const validEmail = (email: unknown): email is string => typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!Array.isArray(emails) || emails.length > 100 || !emails.every(validEmail) || (assignedTo !== null && !validEmail(assignedTo))) throw new TaskError('Choose valid administrators.');
  const administratorEmails = [...new Set([...emails, ...links.administratorEmails].map(email => email.trim().toLowerCase()))].sort();
  const studentIds = [...new Set([...(merged.studentIds as number[]), ...links.studentIds])].sort((a, b) => a - b);
  const courseIds = [...new Set([...(merged.courseIds as number[]), ...links.courseIds])].sort((a, b) => a - b);
  const eventIds = [...new Set([...(merged.eventIds as number[]), ...links.eventIds])].sort((a, b) => a - b);
  const meetingIds = [...new Set([...(merged.meetingIds as number[]), ...links.meetingIds])].sort((a, b) => a - b);
  return { status, title: taskText(merged.title, 200, true), description, dueDate: dueDate(merged.dueDate), studentIds, courseIds, eventIds, meetingIds, administratorEmails, assignedTo: assignedTo?.trim().toLowerCase() ?? null };
}

export { schoolToday } from './calendar-dates';
