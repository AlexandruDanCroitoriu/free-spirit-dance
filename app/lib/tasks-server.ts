import { taskColors, type TaskColor } from './task-colors';
import { descriptionDocument } from './task-description';
import { descriptionImageIds, deleteQueuedTaskImages } from './task-image';
import { taskMoveState } from './tasks';
import { env } from './storage';
import { TaskError, manualTaskFields, manualTaskId, schoolToday, taskRevision, type BoardTask, type ManualTaskFields, type TaskBoard, type TaskList, type NamedTaskBoard } from './tasks';

const ownerEmail = 'croitoriu.alexandru.code@gmail.com';
type TaskRow = ManualTaskFields & { id: number; listId: number | null; inboxOwner: string | null; studentsJson: string; coursesJson: string; eventsJson: string; meetingsJson: string; sortOrder: number; createdBy: string; createdAt: string; updatedBy: string; updatedAt: string; requestKey: string; requestPayload: string };
const columns = `t.id, t.status, t.list_id AS listId, t.inbox_owner AS inboxOwner, t.title, t.description, t.due_date AS dueDate, (SELECT json_group_array(json_object('id', s.id, 'name', trim(s.first_name || ' ' || s.last_name), 'picture', s.picture)) FROM task_students ts JOIN students s ON s.id = ts.student_id WHERE ts.task_id = t.id ORDER BY s.id) AS studentsJson, (SELECT json_group_array(json_object('id', c.id, 'name', c.name)) FROM task_courses tc JOIN courses c ON c.id = tc.course_id WHERE tc.task_id = t.id) AS coursesJson, t.sort_order AS sortOrder,
  t.created_by AS createdBy, t.created_at AS createdAt, t.updated_by AS updatedBy, t.updated_at AS updatedAt,
  (SELECT json_group_array(json_object('id', e.id, 'name', e.name)) FROM task_free_events te JOIN free_events e ON e.id = te.event_id WHERE te.task_id = t.id) AS eventsJson, (SELECT json_group_array(json_object('id', m.id, 'eventId', e.id, 'name', m.name, 'eventName', e.name)) FROM task_free_meetings tm JOIN free_event_meetings m ON m.id = tm.meeting_id JOIN free_events e ON e.id = m.event_id WHERE tm.task_id = t.id) AS meetingsJson,
  t.request_key AS requestKey, t.request_payload AS requestPayload, t.administrator_emails AS administratorEmailsJson, t.assigned_to AS assignedTo`;

export const taskJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function taskHandler(work: () => Promise<Response>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof TaskError) return taskJson({ error: error.message }, error.status);
    const message = String(error);
    if (/no such table: (task_free_events|task_free_meetings)/.test(message)) return taskJson({ error: 'Task event links are not set up. Apply migration 0075.' }, 503);
    if (/no such table: task_courses/.test(message)) return taskJson({ error: 'Task course links are not set up. Apply migration 0063.' }, 503);
    if (/no such table: task_images/.test(message)) return taskJson({ error: 'Task images are not set up. Apply migration 0065.' }, 503);
    if (/no such table: task_students/.test(message)) return taskJson({ error: 'Task student links are not set up. Apply migration 0060.' }, 503);
    if (/no such table: task_preferences|no such column: selected_board_scope/.test(message)) return taskJson({ error: 'Task preferences are not set up. Apply migration 0062.' }, 503);
    if (/no such column: (b\.|l\.)?color/.test(message)) return taskJson({ error: 'Task colors are not set up. Apply migration 0061.' }, 503);
    if (/Task board changed/.test(message)) return taskJson({ error: 'The task board changed. Reload before saving.' }, 409);
    if (/no such table: (task_boards|task_lists)|no such column: (list_id|t.list_id)/.test(message)) return taskJson({ error: 'Task boards are not set up. Apply migration 0057.' }, 503);
    if (/no such column: (b\.)?owner_email/.test(message)) return taskJson({ error: 'Personal boards are not set up. Apply migration 0059.' }, 503);
    if (/no such column: (t\.)?inbox_owner/.test(message)) return taskJson({ error: 'Personal inboxes are not set up. Apply migration 0058.' }, 503);
    if (/no such table: (manual_tasks|task_board_state)|no such column: can_tasks/.test(message)) return taskJson({ error: 'Tasks are not set up in this database. Apply migration 0055.' }, 503);
    if (/FOREIGN KEY|UNIQUE|CHECK|NOT NULL/.test(message)) return taskJson({ error: 'The task or linked student changed. Reload and retry.' }, 409);
    console.error('Task operation failed', error instanceof Error ? error.name : 'Unknown error');
    return taskJson({ error: 'Could not complete the task operation. Please retry.' }, 500);
  }
}

export async function taskAccess(request: Request): Promise<string> {
  // The Worker supplies the owner identity on plain localhost during development.
  // Keep the same fallback for direct local route execution, but never on a tunnel.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  const email = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase() || (local ? ownerEmail : '');
  if (!email) throw new TaskError('Sign in to manage tasks.', 401);
  if (email !== ownerEmail) {
    const permission = await env.DB.prepare('SELECT can_tasks FROM administrator_permissions WHERE email = ?').bind(email).first<{ can_tasks: number }>();
    if (permission?.can_tasks !== 1) throw new TaskError('You do not have permission to manage tasks.', 403);
  }
  return email;
}

export async function taskInput(request: Request, allowed: string[]): Promise<Record<string, unknown>> {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new TaskError('Cross-origin writes are not allowed.', 403);
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new TaskError('Send JSON task details.', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new TaskError('Task details are required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); throw new TaskError('Task details are too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new TaskError('Send valid JSON task details.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TaskError('Task details must be an object.');
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new TaskError('Unsupported task field.');
  return input as Record<string, unknown>;
}

function serialize(row: TaskRow): BoardTask {
  return { key: `manual:${row.id}`, status: row.status ?? 'in_progress', listId: row.listId, source: 'manual', category: 'manual', title: row.title, description: row.description,
    dueDate: row.dueDate, students: JSON.parse(row.studentsJson), courses: JSON.parse(row.coursesJson), events: JSON.parse(row.eventsJson), meetings: JSON.parse(row.meetingsJson),
    sortOrder: row.sortOrder, canDelete: true, administratorEmails: JSON.parse((row as TaskRow & { administratorEmailsJson: string }).administratorEmailsJson ?? '[]'), assignedTo: row.assignedTo ?? null,
    createdBy: row.createdBy, createdAt: row.createdAt, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}
type TaskSnapshot = { inboxColor: TaskColor; selectedBoardScope: 'school' | 'personal'; rows: TaskRow[]; lists: TaskList[]; boards: NamedTaskBoard[]; revision: number };
// Apply privacy at the SQL boundary, including all mutation response snapshots.
function snapshotStatements(email: string) {
  return [env.DB.prepare("SELECT inbox_color AS color, selected_board_scope AS selectedBoardScope FROM task_preferences WHERE email = ?").bind(email),
    env.DB.prepare("SELECT id, name, color, CASE WHEN owner_email IS NULL THEN 'school' ELSE 'personal' END AS scope FROM task_boards WHERE owner_email IS NULL OR owner_email = ? ORDER BY id").bind(email),
    env.DB.prepare('SELECT l.id, l.board_id AS boardId, l.name AS title, l.sort_order AS sortOrder, l.color FROM task_lists l JOIN task_boards b ON b.id = l.board_id WHERE b.owner_email IS NULL OR b.owner_email = ? ORDER BY l.sort_order, l.id').bind(email),
    env.DB.prepare(`SELECT ${columns} FROM manual_tasks t LEFT JOIN task_lists l ON l.id = t.list_id LEFT JOIN task_boards b ON b.id = l.board_id WHERE t.inbox_owner = ? OR (t.inbox_owner IS NULL AND (b.owner_email IS NULL OR b.owner_email = ?)) ORDER BY t.sort_order, t.id`).bind(email, email),
    env.DB.prepare('SELECT revision FROM task_board_state WHERE id = 1')];
}
function snapshot(results: D1Result<unknown>[]): TaskSnapshot {
  const state = results.at(-1)?.results[0] as { revision: number } | undefined;
  if (!state) throw new TaskError('Task board state is missing. Restore the database before saving.', 503);
  const preference = results.at(-5)?.results[0] as {color: TaskColor; selectedBoardScope?: 'school' | 'personal'} | undefined;
  return { inboxColor: preference?.color ?? 'default', selectedBoardScope: preference?.selectedBoardScope === 'personal' ? 'personal' : 'school', boards: results.at(-4)!.results as NamedTaskBoard[], lists: results.at(-3)!.results as TaskList[], rows: results.at(-2)!.results as TaskRow[], revision: state.revision };
}
function board(data: TaskSnapshot): TaskBoard {
  return { inboxColor: data.inboxColor, selectedBoardScope: data.selectedBoardScope, tasks: data.rows.map(serialize), boards: data.boards, lists: data.lists, revision: data.revision, today: schoolToday(), views: [{ key: 'all', title: 'All tasks' }, { key: 'manual', title: 'Manual tasks' }] };
}
async function readTaskSnapshot(email: string) { return snapshot(await env.DB.batch(snapshotStatements(email))); }
function guard(revision: number) { return env.DB.prepare('UPDATE task_board_state SET revision = ? WHERE id = 1').bind(revision + 1); }
function profile(email: string) { return env.DB.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email); }
function validList(data: TaskSnapshot, value: unknown): number | null {
  if (value === null) return null; // The authenticated administrator's Inbox.
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || !data.lists.some(list => list.id === value)) throw new TaskError('Choose an existing task list.');
  return value;
}
function requireRevision(expected: number, actual: number) { if (expected !== actual) throw new TaskError('The task board changed. Reload before saving.', 409); }
function findTask(data: TaskSnapshot, key: string) {
  const id = manualTaskId(key), row = data.rows.find(row => row.id === id);
  if (!row) throw new TaskError('Task not found.', 404);
  return serialize(row);
}
function appendPosition(data: TaskSnapshot, listId: number | null) {
  return data.rows.filter(row => row.listId === listId).reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
}
export async function getTasks(request: Request, key?: string) {
  const email = await taskAccess(request), data = await readTaskSnapshot(email);
  if (key !== undefined) return taskJson({ task: findTask(data, key), revision: data.revision });
  const result = board(data), student = new URL(request.url).searchParams.get('studentId');
  if (student !== null) {
    if (!/^[1-9]\d*$/.test(student) || !Number.isSafeInteger(Number(student))) throw new TaskError('Invalid student filter.');
    result.tasks = result.tasks.filter(task => task.students.some(item => item.id === Number(student)));
  }
  return taskJson(result);
}
const editable = ['status', 'title', 'description', 'dueDate', 'studentIds', 'courseIds', 'eventIds', 'meetingIds', 'administratorEmails', 'assignedTo'];
export async function taskAdministrators(request: Request) {
  await taskAccess(request);
  return taskJson(await administratorChoices());
}
export async function taskEventChoices(request: Request) {
  await taskAccess(request);
  const [events, meetings] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, image_path AS imagePath FROM free_events ORDER BY name COLLATE NOCASE, id'),
    env.DB.prepare('SELECT m.id, m.event_id AS eventId, m.name, e.name AS eventName FROM free_event_meetings m JOIN free_events e ON e.id = m.event_id ORDER BY e.name COLLATE NOCASE, m.starts_at, m.id'),
  ]);
  return taskJson({ events: events.results, meetings: meetings.results });
}
export async function assignedTaskNotifications(request: Request) {
  const email = await taskAccess(request);
  const result = await env.DB.prepare(`SELECT t.id, t.title, t.status, t.due_date AS dueDate, l.name AS listName,
    CASE WHEN b.owner_email IS NULL THEN 'school' ELSE 'personal' END AS scope
    FROM manual_tasks t JOIN task_lists l ON l.id = t.list_id JOIN task_boards b ON b.id = l.board_id
    WHERE (b.owner_email IS NULL OR b.owner_email = ? COLLATE NOCASE) AND t.inbox_owner IS NULL AND t.assigned_to = ? COLLATE NOCASE
    ORDER BY t.due_date IS NULL, t.due_date, t.updated_at DESC, t.id DESC`).bind(email, email).all<{ id: number; title: string; status: 'in_progress' | 'blocked' | 'done'; dueDate: string | null; listName: string; scope: 'school' | 'personal' }>();
  return taskJson(result.results);
}
async function administratorChoices() {
  const result = await env.DB.prepare("SELECT directory.email, COALESCE(NULLIF(p.name, ''), directory.email) AS name, p.picture FROM (SELECT email FROM administrator_permissions UNION SELECT ? AS email) directory LEFT JOIN admin_profiles p ON p.email = directory.email ORDER BY name COLLATE NOCASE").bind(ownerEmail).all<{ email: string; name: string; picture: string | null }>();
  return result.results;
}
async function validateAdministrators(fields: ManualTaskFields, previous?: BoardTask) {
  const allowed = new Set((await administratorChoices()).map(item => item.email.toLowerCase()));
  const retained = new Set([...(previous?.administratorEmails ?? []), previous?.assignedTo]);
  if ([...(fields.administratorEmails ?? []), fields.assignedTo].some(email => email && !allowed.has(email) && !retained.has(email))) throw new TaskError('Choose an existing administrator.');
}
async function validateTaskImages(description: string, email: string, taskId?: number) {
  const ids = descriptionImageIds(descriptionDocument(description));
  if (!ids.length) return ids;
  const rows = await env.DB.prepare(`SELECT id FROM task_images
    WHERE id IN (SELECT value FROM json_each(?))
      AND ((task_id IS NULL AND owner_email = ?) OR task_id = ?) AND (expires_at IS NULL OR expires_at > datetime('now'))`)
    .bind(JSON.stringify(ids), email, taskId ?? -1).all<{ id: string }>();
  if (rows.results.length !== ids.length) throw new TaskError('One or more task images are no longer available. Remove them and upload again.', 409);
  return ids;
}
function taskImageStatements(taskId: number | string, ids: string[]) {
  return [env.DB.prepare('DELETE FROM task_images WHERE task_id = ? AND id NOT IN (SELECT value FROM json_each(?))').bind(taskId, JSON.stringify(ids)),
    env.DB.prepare('UPDATE task_images SET task_id = ?, expires_at = NULL WHERE id IN (SELECT value FROM json_each(?))').bind(taskId, JSON.stringify(ids))];
}
function createdTaskImageStatements(requestKey: string, ids: string[]) {
  return [env.DB.prepare(`DELETE FROM task_images WHERE task_id = (SELECT id FROM manual_tasks WHERE request_key = ?) AND id NOT IN (SELECT value FROM json_each(?))`).bind(requestKey, JSON.stringify(ids)),
    env.DB.prepare(`UPDATE task_images SET task_id = (SELECT id FROM manual_tasks WHERE request_key = ?), expires_at = NULL WHERE id IN (SELECT value FROM json_each(?))`).bind(requestKey, JSON.stringify(ids))];
}
export async function createTask(request: Request) {
  const email = await taskAccess(request), input = await taskInput(request, [...editable, 'listId', 'revision', 'requestKey']);
  const expected = taskRevision(input.revision), fields = manualTaskFields(input);
  if (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey)) throw new TaskError('A valid creation request key is required.');
  const data = await readTaskSnapshot(email), listId = input.listId === undefined ? null : validList(data, input.listId);
  const payload = JSON.stringify({ ...fields, email, listId });
  const previous = data.rows.find(task => task.requestKey === input.requestKey);
  if (previous) {
    if (previous.requestPayload !== payload) throw new TaskError('This request key was already used for different task details.', 409);
    return taskJson({ task: serialize(previous), revision: data.revision });
  }
  requireRevision(expected, data.revision);
  await validateAdministrators(fields);
  const imageIds = await validateTaskImages(fields.description, email);
  const now = new Date().toISOString();
  const result = snapshot(await env.DB.batch([guard(expected), profile(email),
    env.DB.prepare(`INSERT INTO manual_tasks (list_id, inbox_owner, title, description, due_date, sort_order, created_by, created_at, updated_by, updated_at, request_key, request_payload, administrator_emails, assigned_to, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(listId, listId === null ? email : null, fields.title, fields.description, fields.dueDate, appendPosition(data, listId), email, now, email, now, input.requestKey, payload, JSON.stringify(fields.administratorEmails), fields.assignedTo ?? null, fields.status),
    env.DB.prepare('INSERT INTO task_students(task_id, student_id) SELECT t.id, value FROM manual_tasks t, json_each(?) WHERE t.request_key = ?').bind(JSON.stringify(fields.studentIds), input.requestKey),
    env.DB.prepare('INSERT INTO task_courses(task_id, course_id) SELECT t.id, value FROM manual_tasks t, json_each(?) WHERE t.request_key = ?').bind(JSON.stringify(fields.courseIds), input.requestKey),
    env.DB.prepare('INSERT INTO task_free_events(task_id, event_id) SELECT t.id, value FROM manual_tasks t, json_each(?) WHERE t.request_key = ?').bind(JSON.stringify(fields.eventIds), input.requestKey),
    env.DB.prepare('INSERT INTO task_free_meetings(task_id, meeting_id) SELECT t.id, value FROM manual_tasks t, json_each(?) WHERE t.request_key = ?').bind(JSON.stringify(fields.meetingIds), input.requestKey),
    ...createdTaskImageStatements(input.requestKey, imageIds), ...snapshotStatements(email)]));
  await deleteQueuedTaskImages();
  return taskJson({ task: serialize(result.rows.find(task => task.requestKey === input.requestKey)!), revision: result.revision }, 201);
}
export async function duplicateTask(request: Request, key: string) {
  const email = await taskAccess(request), input = await taskInput(request, ['revision', 'requestKey']);
  const expected = taskRevision(input.revision);
  if (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey)) throw new TaskError('A valid duplication request key is required.');
  const data = await readTaskSnapshot(email), source = findTask(data, key);
  const payload = JSON.stringify({ source: key, email });
  const previous = data.rows.find(task => task.requestKey === input.requestKey);
  if (previous) {
    if (previous.requestPayload !== payload) throw new TaskError('This duplication request was already used for a different task.', 409);
    return taskJson({ task: serialize(previous), revision: data.revision });
  }
  requireRevision(expected, data.revision);
  const fields: ManualTaskFields = { status: source.status, title: `${source.title} (duplicated)`, description: source.description, dueDate: source.dueDate, studentIds: source.students.map(student => student.id), courseIds: source.courses.map(course => course.id), eventIds: source.events.map(event => event.id), meetingIds: source.meetings.map(meeting => meeting.id), administratorEmails: source.administratorEmails, assignedTo: source.assignedTo };
  await validateAdministrators(fields, source);
  const sourceId = manualTaskId(key), imageIds = descriptionImageIds(descriptionDocument(source.description));
  const images = imageIds.length ? (await env.DB.prepare('SELECT id, object_key AS objectKey FROM task_images WHERE task_id = ? AND id IN (SELECT value FROM json_each(?))').bind(sourceId, JSON.stringify(imageIds)).all<{ id: string; objectKey: string }>()).results : [];
  if (images.length !== imageIds.length) throw new TaskError('One or more task images are no longer available.');
  const copies: { oldId: string; id: string; objectKey: string }[] = [];
  try {
    for (const image of images) {
      const id = crypto.randomUUID(), objectKey = `task-images/${id}.jpg`, original = await env.STUDENT_IMAGES.get(image.objectKey);
      if (!original?.body) throw new TaskError('One or more task images are no longer available.');
      await env.STUDENT_IMAGES.put(objectKey, original.body, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'private, max-age=3600' } });
      copies.push({ oldId: image.id, id, objectKey });
    }
    const description = copies.reduce((value, copy) => value.replaceAll(copy.oldId, copy.id), fields.description);
    const now = new Date().toISOString();
    const result = snapshot(await env.DB.batch([guard(expected), profile(email),
      env.DB.prepare(`INSERT INTO manual_tasks (list_id, inbox_owner, title, description, due_date, sort_order, created_by, created_at, updated_by, updated_at, request_key, request_payload, administrator_emails, assigned_to, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(source.listId, source.listId === null ? email : null, fields.title, description, fields.dueDate, appendPosition(data, source.listId), email, now, email, now, input.requestKey, payload, JSON.stringify(fields.administratorEmails), fields.assignedTo ?? null, fields.status),
      env.DB.prepare('INSERT INTO task_students(task_id, student_id) SELECT t.id, student_id FROM manual_tasks t JOIN task_students source ON source.task_id = ? WHERE t.request_key = ?').bind(sourceId, input.requestKey),
      env.DB.prepare('INSERT INTO task_courses(task_id, course_id) SELECT t.id, course_id FROM manual_tasks t JOIN task_courses source ON source.task_id = ? WHERE t.request_key = ?').bind(sourceId, input.requestKey),
      env.DB.prepare('INSERT INTO task_free_events(task_id, event_id) SELECT t.id, event_id FROM manual_tasks t JOIN task_free_events source ON source.task_id = ? WHERE t.request_key = ?').bind(sourceId, input.requestKey),
      env.DB.prepare('INSERT INTO task_free_meetings(task_id, meeting_id) SELECT t.id, meeting_id FROM manual_tasks t JOIN task_free_meetings source ON source.task_id = ? WHERE t.request_key = ?').bind(sourceId, input.requestKey),
      ...copies.map(copy => env.DB.prepare('INSERT INTO task_images(id, task_id, owner_email, object_key, created_at) SELECT ?, id, ?, ?, ? FROM manual_tasks WHERE request_key = ?').bind(copy.id, email, copy.objectKey, now, input.requestKey)),
      ...snapshotStatements(email)]));
    return taskJson({ task: serialize(result.rows.find(task => task.requestKey === input.requestKey)!), revision: result.revision }, 201);
  } catch (error) {
    await Promise.all(copies.map(copy => env.STUDENT_IMAGES.delete(copy.objectKey).catch(() => undefined)));
    throw error;
  }
}
export async function updateTask(request: Request, key: string) {
  const email = await taskAccess(request), input = await taskInput(request, [...editable, 'listId', 'revision']);
  const data = await readTaskSnapshot(email), current = findTask(data, key), expected = taskRevision(input.revision);
  requireRevision(expected, data.revision);
  if (!editable.some(field => Object.hasOwn(input, field)) && input.listId === undefined) throw new TaskError('Choose a task field to update.');
  const listId = input.listId === undefined ? current.listId : validList(data, input.listId);
  const position = listId === current.listId ? current.sortOrder : appendPosition(data, listId);
  const fields = manualTaskFields(input, { status: current.status, title: current.title, description: current.description, dueDate: current.dueDate, studentIds: current.students.map(student => student.id), courseIds: current.courses.map(course => course.id), eventIds: current.events.map(event => event.id), meetingIds: current.meetings.map(meeting => meeting.id), administratorEmails: current.administratorEmails, assignedTo: current.assignedTo });
  await validateAdministrators(fields, current);
  const imageIds = await validateTaskImages(fields.description, email, manualTaskId(key));
  const result = snapshot(await env.DB.batch([guard(expected), profile(email),
    env.DB.prepare('UPDATE manual_tasks SET list_id = ?, inbox_owner = ?, title = ?, description = ?, due_date = ?, sort_order = ?, updated_by = ?, updated_at = ?, administrator_emails = ?, assigned_to = ?, status = ? WHERE id = ?')
      .bind(listId, listId === null ? email : null, fields.title, fields.description, fields.dueDate, position, email, new Date().toISOString(), JSON.stringify(fields.administratorEmails), fields.assignedTo ?? null, fields.status, manualTaskId(key)),
    env.DB.prepare('DELETE FROM task_students WHERE task_id = ?').bind(manualTaskId(key)),
    env.DB.prepare('INSERT INTO task_students(task_id, student_id) SELECT ?, value FROM json_each(?)').bind(manualTaskId(key), JSON.stringify(fields.studentIds)),
    env.DB.prepare('DELETE FROM task_courses WHERE task_id = ?').bind(manualTaskId(key)),
    env.DB.prepare('INSERT INTO task_courses(task_id, course_id) SELECT ?, value FROM json_each(?)').bind(manualTaskId(key), JSON.stringify(fields.courseIds)),
    env.DB.prepare('DELETE FROM task_free_events WHERE task_id = ?').bind(manualTaskId(key)),
    env.DB.prepare('INSERT INTO task_free_events(task_id, event_id) SELECT ?, value FROM json_each(?)').bind(manualTaskId(key), JSON.stringify(fields.eventIds)),
    env.DB.prepare('DELETE FROM task_free_meetings WHERE task_id = ?').bind(manualTaskId(key)),
    env.DB.prepare('INSERT INTO task_free_meetings(task_id, meeting_id) SELECT ?, value FROM json_each(?)').bind(manualTaskId(key), JSON.stringify(fields.meetingIds)),
    ...taskImageStatements(manualTaskId(key), imageIds), ...snapshotStatements(email)]));
  await deleteQueuedTaskImages();
  return taskJson({ task: findTask(result, key), revision: result.revision });
}
export async function deleteTask(request: Request, key: string) {
  const email = await taskAccess(request), input = await taskInput(request, ['revision']), expected = taskRevision(input.revision), data = await readTaskSnapshot(email);
  findTask(data, key); requireRevision(expected, data.revision);
  const result = snapshot(await env.DB.batch([guard(expected), env.DB.prepare('DELETE FROM manual_tasks WHERE id = ?').bind(manualTaskId(key)), ...snapshotStatements(email)]));
  await deleteQueuedTaskImages();
  return taskJson({ deleted: true, revision: result.revision });
}
export async function moveTask(request: Request) {
  const email = await taskAccess(request), input = await taskInput(request, ['key', 'listId', 'position', 'targetKey', 'revision', 'moveState']);
  for (let attempt = 0; ; attempt++) {
    try { return await applyTaskMove(email, input); }
    catch (error) {
      // The transactional guard may observe an unrelated write after our read.
      // Read again and revalidate the affected lists before retrying.
      if (attempt >= 2 || typeof input.moveState !== 'string' || error instanceof TaskError || !/Task board changed/.test(String(error))) throw error;
    }
  }
}
async function applyTaskMove(email: string, input: Record<string, unknown>) {
  if (typeof input.key !== 'string') throw new TaskError('A task key is required.');
  let expected = taskRevision(input.revision);
  if (typeof input.position !== 'string' || !['before', 'after', 'top', 'bottom'].includes(input.position)) throw new TaskError('Choose before, after, top, or bottom.');
  const relative = input.position === 'before' || input.position === 'after';
  if (relative ? typeof input.targetKey !== 'string' : input.targetKey !== undefined) throw new TaskError('Supply a target task only for before/after moves.');
  if (input.targetKey === input.key) throw new TaskError('A task cannot be moved relative to itself.');
  const data = await readTaskSnapshot(email), current = findTask(data, input.key);
  const listId = input.listId === undefined ? current.listId : validList(data, input.listId);
  if (input.moveState !== undefined) {
    if (typeof input.moveState !== 'string' || input.moveState !== taskMoveState(board(data), input.key, listId)) throw new TaskError('This task or its list order changed. Refresh the board and review the move.', 409);
    expected = data.revision;
  } else requireRevision(expected, data.revision);
  const destination = board(data).tasks.filter(task => task.listId === listId && task.key !== input.key);
  const targetIndex = relative ? destination.findIndex(task => task.key === input.targetKey) : -1;
  if (relative && targetIndex === -1) throw new TaskError('The target task is not in the destination list.', 409);
  const index = input.position === 'top' ? 0 : input.position === 'bottom' ? destination.length : targetIndex + (input.position === 'after' ? 1 : 0);
  destination.splice(index, 0, current);
  const now = new Date().toISOString(), changes: D1PreparedStatement[] = [];
  const values = destination.map((task, sortOrder) => ({ id: manualTaskId(task.key), sortOrder, moved: task.key === current.key ? 1 : 0 }));
  for (let offset = 0; offset < values.length; offset += 500) changes.push(env.DB.prepare(`UPDATE manual_tasks AS task
    SET sort_order = json_extract(item.value, '$.sortOrder'), list_id = ?, inbox_owner = ?,
      updated_by = CASE WHEN json_extract(item.value, '$.moved') = 1 THEN ? ELSE task.updated_by END,
      updated_at = CASE WHEN json_extract(item.value, '$.moved') = 1 THEN ? ELSE task.updated_at END
    FROM json_each(?) AS item WHERE task.id = json_extract(item.value, '$.id')`)
    .bind(listId, listId === null ? email : null, email, now, JSON.stringify(values.slice(offset, offset + 500))));
  const result = snapshot(await env.DB.batch([guard(expected), profile(email), ...changes, ...snapshotStatements(email)]));
  return taskJson(board(result));
}

export async function createTaskList(request: Request) {
  const email = await taskAccess(request);
  const input = await taskInput(request, ['name', 'scope', 'revision', 'requestKey']);
  if (input.scope !== 'school' && input.scope !== 'personal') throw new TaskError('Choose School or Personal.');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100 || input.name.includes('\0')) throw new TaskError('Enter a name of 1–100 characters.');
  if (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey)) throw new TaskError('A valid creation request key is required.');
  const name = input.name.trim(), data = await readTaskSnapshot(email);
  const previous = await env.DB.prepare('SELECT l.id, l.name, b.owner_email AS ownerEmail FROM task_lists l JOIN task_boards b ON b.id = l.board_id WHERE l.request_key = ?').bind(input.requestKey).first<{id: number; name: string; ownerEmail: string | null}>();
  if (previous) {
    const owner = input.scope === 'personal' ? email : null;
    if (previous.ownerEmail !== owner || previous.name !== name) throw new TaskError('This creation request was already used.', 409);
    return taskJson({ ...board(await readTaskSnapshot(email)), createdId: previous.id });
  }
  const expected = taskRevision(input.revision); requireRevision(expected, data.revision);
  const personal = input.scope === 'personal';
  const setup = personal ? [profile(email), env.DB.prepare("INSERT INTO task_boards(name, owner_email) VALUES ('Personal', ?) ON CONFLICT(owner_email) DO NOTHING").bind(email)] : [];
  const write = env.DB.prepare(`INSERT INTO task_lists(board_id, name, sort_order, request_key)
    SELECT b.id, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM task_lists WHERE board_id = b.id), ?
    FROM task_boards b WHERE ${personal ? 'b.owner_email = ?' : 'b.owner_email IS NULL'} RETURNING id`)
    .bind(name, input.requestKey, ...(personal ? [email] : []));
  const result = await env.DB.batch([guard(expected), ...setup, write, ...snapshotStatements(email)]);
  return taskJson({ ...board(snapshot(result)), createdId: (result[1 + setup.length].results[0] as { id: number }).id }, 201);
}

export async function updateTaskColor(request: Request) {
  const email = await taskAccess(request), input = await taskInput(request, ['target', 'scope', 'listId', 'color', 'revision']);
  if (!taskColors.some(color => color.key === input.color)) throw new TaskError('Choose a color preset.');
  const data = await readTaskSnapshot(email), expected = taskRevision(input.revision);
  requireRevision(expected, data.revision);
  const writes: D1PreparedStatement[] = [guard(expected), profile(email)];
  if (input.target === 'inbox' && input.scope === undefined && input.listId === undefined) {
    writes.push(env.DB.prepare('INSERT INTO task_preferences(email, inbox_color) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET inbox_color = excluded.inbox_color').bind(email, input.color));
  } else if (input.target === 'board' && input.listId === undefined && (input.scope === 'school' || input.scope === 'personal')) {
    if (input.scope === 'personal') writes.push(env.DB.prepare("INSERT INTO task_boards(name, owner_email) VALUES ('Personal', ?) ON CONFLICT(owner_email) DO NOTHING").bind(email));
    writes.push(input.scope === 'personal'
      ? env.DB.prepare('UPDATE task_boards SET color = ? WHERE owner_email = ?').bind(input.color, email)
      : env.DB.prepare('UPDATE task_boards SET color = ? WHERE owner_email IS NULL').bind(input.color));
  } else if (input.target === 'list' && input.scope === undefined) {
    const id = validList(data, input.listId);
    if (id === null) throw new TaskError('Choose a list.');
    writes.push(env.DB.prepare('UPDATE task_lists SET color = ? WHERE id = ?').bind(input.color, id));
  } else throw new TaskError('Choose a list, board, or Inbox.');
  return taskJson(board(snapshot(await env.DB.batch([...writes, ...snapshotStatements(email)]))));
}

export async function updateTaskViewPreference(request: Request) {
  const email = await taskAccess(request), input = await taskInput(request, ['selectedBoardScope']);
  if (input.selectedBoardScope !== 'school' && input.selectedBoardScope !== 'personal') throw new TaskError('Choose the School or Personal board.');
  await env.DB.batch([profile(email), env.DB.prepare("INSERT INTO task_preferences(email, inbox_color, selected_board_scope) VALUES (?, 'default', ?) ON CONFLICT(email) DO UPDATE SET selected_board_scope = excluded.selected_board_scope").bind(email, input.selectedBoardScope)]);
  return taskJson(board(await readTaskSnapshot(email)));
}

export async function moveTaskList(request: Request) {
  const email = await taskAccess(request), input = await taskInput(request, ['listId', 'targetId', 'position', 'revision']);
  const data = await readTaskSnapshot(email), expected = taskRevision(input.revision);
  requireRevision(expected, data.revision);
  const id = validList(data, input.listId), targetId = validList(data, input.targetId);
  if (id === null || targetId === null || id === targetId || (input.position !== 'before' && input.position !== 'after')) throw new TaskError('Choose another list and a valid position.');
  const source = data.lists.find(list => list.id === id)!;
  const lists = data.lists.filter(list => list.boardId === source.boardId && list.id !== id);
  const index = lists.findIndex(list => list.id === targetId);
  if (index < 0) throw new TaskError('Lists must remain on the same board.');
  lists.splice(index + (input.position === 'after' ? 1 : 0), 0, source);
  const writes: D1PreparedStatement[] = [guard(expected)];
  const positions = lists.map((list, sortOrder) => ({ id: list.id, sortOrder }));
  for (let offset = 0; offset < positions.length; offset += 500) writes.push(env.DB.prepare(`UPDATE task_lists AS list SET sort_order = json_extract(item.value, '$.sortOrder') FROM json_each(?) item WHERE list.id = json_extract(item.value, '$.id')`).bind(JSON.stringify(positions.slice(offset, offset + 500))));
  return taskJson(board(snapshot(await env.DB.batch([...writes, ...snapshotStatements(email)]))));
}

export async function renameTaskList(request: Request, listId: string) {
  const email = await taskAccess(request), input = await taskInput(request, ['name', 'revision']);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100 || input.name.includes('\0')) throw new TaskError('Enter a name of 1–100 characters.');
  const data = await readTaskSnapshot(email), expected = taskRevision(input.revision);
  requireRevision(expected, data.revision);
  const id = validList(data, Number(listId));
  if (id === null || String(id) !== listId) throw new TaskError('Choose an existing task list.');
  return taskJson(board(snapshot(await env.DB.batch([guard(expected), env.DB.prepare('UPDATE task_lists SET name = ? WHERE id = ?').bind(input.name.trim(), id), ...snapshotStatements(email)]))));
}

export async function removeTaskList(request: Request, listId: string) {
  const email = await taskAccess(request), input = await taskInput(request, ['revision']);
  const data = await readTaskSnapshot(email), expected = taskRevision(input.revision);
  requireRevision(expected, data.revision);
  const id = validList(data, Number(listId));
  if (id === null || String(id) !== listId) throw new TaskError('Choose an existing task list.');
  if (data.rows.some(task => task.listId === id)) throw new TaskError('Move or delete all cards before removing this list.', 409);
  return taskJson(board(snapshot(await env.DB.batch([guard(expected), env.DB.prepare('DELETE FROM task_lists WHERE id = ?').bind(id), ...snapshotStatements(email)]))));
}
