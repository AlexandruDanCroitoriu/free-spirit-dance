import { env } from './storage';
import { automaticTaskKey, normalizeAutomatic, evaluateTaskRules, taskRules, type AutomaticCandidate, type AutomaticOccurrence, type RuleSnapshot, type RuleState, type RuleStudent } from './task-rules';
import { TaskError, manualTaskFields, manualTaskId, schoolToday, taskColumns, taskRevision, taskStatus, type BoardTask, type ManualTaskFields, type TaskBoard } from './tasks';

const ownerEmail = 'croitoriu.alexandru.code@gmail.com';
type TaskRow = ManualTaskFields & { id: number; studentName: string | null; sortOrder: number; createdBy: string; createdAt: string; updatedBy: string; updatedAt: string; requestKey: string; requestPayload: string };
const columns = `t.id, t.title, t.description, t.due_date AS dueDate, t.status, t.student_id AS studentId,
  trim(s.first_name || ' ' || s.last_name) AS studentName, t.sort_order AS sortOrder,
  t.created_by AS createdBy, t.created_at AS createdAt, t.updated_by AS updatedBy, t.updated_at AS updatedAt,
  t.request_key AS requestKey, t.request_payload AS requestPayload`;

export const taskJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function taskHandler(work: () => Promise<Response>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof TaskError) return taskJson({ error: error.message }, error.status);
    const message = String(error);
    if (/Task board changed/.test(message)) return taskJson({ error: 'The task board changed. Reload before saving.' }, 409);
    if (/no such table: (automatic_task_occurrences|task_rule_state)/.test(message)) return taskJson({ error: 'Automatic tasks are not set up in this database. Apply migration 0056.' }, 503);
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
  return { key: `manual:${row.id}`, source: 'manual', category: 'manual', title: row.title, description: row.description,
    dueDate: row.dueDate, status: row.status, student: row.studentId === null ? null : { id: row.studentId, name: row.studentName ?? '' },
    sortOrder: row.sortOrder, dismissed: false, canEditContent: true, canDelete: true,
    createdBy: row.createdBy, createdAt: row.createdAt, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}
export type TaskSnapshot = RuleSnapshot & { rows: TaskRow[]; revision: number };
export function snapshotStatements() {
  return [env.DB.prepare(`SELECT ${columns} FROM manual_tasks t LEFT JOIN students s ON s.id = t.student_id ORDER BY t.sort_order, t.id`),
    env.DB.prepare(`SELECT id, rule_key AS ruleKey, subject_key AS subjectKey, occurrence_key AS occurrenceKey, student_id AS studentId, unlinked,
      title, description, due_date AS dueDate, status, dismissed, sort_order AS sortOrder, created_by AS createdBy, created_at AS createdAt, updated_by AS updatedBy, updated_at AS updatedAt FROM automatic_task_occurrences ORDER BY sort_order, id`),
    env.DB.prepare('SELECT rule_key AS ruleKey, activated_on AS activatedOn, evaluated_on AS evaluatedOn FROM task_rule_state'),
    env.DB.prepare('SELECT id, first_name AS firstName, last_name AS lastName, birth_date AS birthDate, active FROM students ORDER BY id'),
    env.DB.prepare('SELECT revision FROM task_board_state WHERE id = 1')];
}
export function snapshot(results: D1Result<unknown>[]): TaskSnapshot {
  const state = results.at(-1)?.results[0] as { revision: number } | undefined;
  if (!state) throw new TaskError('Task board state is missing. Restore the database before saving.', 503);
  return { rows: results.at(-5)!.results as TaskRow[], occurrences: results.at(-4)!.results as AutomaticOccurrence[], states: results.at(-3)!.results as RuleState[], students: results.at(-2)!.results as RuleStudent[], revision: state.revision };
}
export function board(data: TaskSnapshot, today = schoolToday()): TaskBoard {
  const tasks = [...data.rows.map(serialize), ...data.occurrences.map(row => normalizeAutomatic(row, data.students, row))];
  let nextOrder = tasks.filter(task => task.status === 'todo').reduce((max, task) => Math.max(max, task.sortOrder + 1), 0);
  for (const candidate of evaluateTaskRules(data, today).calculated) tasks.push(normalizeAutomatic(candidate, data.students, undefined, nextOrder++));
  tasks.sort((a, b) => taskColumns.findIndex(column => column.status === a.status) - taskColumns.findIndex(column => column.status === b.status) || a.sortOrder - b.sortOrder);
  return { tasks, revision: data.revision, today, columns: taskColumns, views: [{ key: 'all', title: 'All tasks' }, { key: 'manual', title: 'Manual tasks' }, ...taskRules.map(rule => ({ key: rule.key, title: rule.title }))] };
}
export async function readTaskSnapshot() { return snapshot(await env.DB.batch(snapshotStatements())); }
export function guard(revision: number) { return env.DB.prepare('UPDATE task_board_state SET revision = ? WHERE id = 1').bind(revision + 1); }
export function profile(email: string) { return env.DB.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email); }
function requireRevision(expected: number, actual: number) { if (expected !== actual) throw new TaskError('The task board changed. Reload before saving.', 409); }
function automaticIdentity(key: string): Pick<AutomaticCandidate, 'ruleKey' | 'subjectKey' | 'occurrenceKey'> {
  const parts = key.split(':');
  if (parts.length !== 4 || parts[0] !== 'automatic') throw new TaskError('Invalid automatic task key.');
  try {
    const [ruleKey, subjectKey, occurrenceKey] = parts.slice(1).map(decodeURIComponent);
    if (!ruleKey || !subjectKey || !occurrenceKey || ruleKey.length > 80 || subjectKey.length > 200 || occurrenceKey.length > 200) throw new Error('Invalid identity');
    const identity = { ruleKey, subjectKey, occurrenceKey };
    if (automaticTaskKey(identity) !== key) throw new Error('Invalid encoding');
    return identity;
  } catch { throw new TaskError('Invalid automatic task key.'); }
}
function validateKey(key: string) { if (key.startsWith('manual:')) manualTaskId(key); else automaticIdentity(key); }
function findTask(data: TaskSnapshot, key: string) {
  validateKey(key);
  const task = board(data).tasks.find(task => task.key === key);
  if (!task) throw new TaskError('Task not found.', 404);
  return task;
}
const nextOrderSql = `(SELECT COALESCE(MAX(sort_order), -1) + 1 FROM (SELECT sort_order FROM manual_tasks WHERE status = 'todo' UNION ALL SELECT sort_order FROM automatic_task_occurrences WHERE status = 'todo'))`;
export function insertOccurrence(value: AutomaticCandidate, now: string, sortOrder: number | null = null, email: string | null = null, insertedStudent = false) {
  // The creation route already uses SQLite's inserted-student identity. The
  // students sequence remains stable after course/occurrence inserts in a batch.
  const studentSql = insertedStudent ? "(SELECT seq FROM sqlite_sequence WHERE name = 'students')" : '?';
  const subjectSql = insertedStudent ? `replace(?, '{inserted-student}', ${studentSql})` : '?';
  const subject = insertedStudent ? taskRules.find(rule => rule.key === value.ruleKey)?.remapSubject?.(value.subjectKey, id => id === '0' ? '{inserted-student}' : id) ?? value.subjectKey : value.subjectKey;
  const values: (string | number | null)[] = [value.ruleKey, subject];
  values.push(value.occurrenceKey);
  if (!insertedStudent) values.push(value.studentId);
  values.push(value.title, value.description, value.dueDate);
  if (sortOrder !== null) values.push(sortOrder);
  values.push(email, now, email, now);
  return env.DB.prepare(`INSERT INTO automatic_task_occurrences (rule_key, subject_key, occurrence_key, student_id, title, description, due_date, sort_order, created_by, created_at, updated_by, updated_at)
    VALUES (?, ${subjectSql}, ?, ${studentSql}, ?, ?, ?, ${sortOrder === null ? nextOrderSql : '?'}, ?, ?, ?, ?)
    ON CONFLICT(rule_key, subject_key, occurrence_key) DO NOTHING`).bind(...values);
}
function taskWhere(task: BoardTask) {
  if (task.source === 'manual') return { table: 'manual_tasks', where: 'id = ?', values: [manualTaskId(task.key)] };
  const value = automaticIdentity(task.key);
  return { table: 'automatic_task_occurrences', where: 'rule_key = ? AND subject_key = ? AND occurrence_key = ?', values: [value.ruleKey, value.subjectKey, value.occurrenceKey] };
}
function materialize(task: BoardTask, data: TaskSnapshot, now: string) {
  if (task.source !== 'automatic' || data.occurrences.some(row => automaticTaskKey(row) === task.key)) return [];
  return [insertOccurrence({ ...automaticIdentity(task.key), studentId: task.student?.id ?? null, title: task.title, description: task.description, dueDate: task.dueDate }, now, task.sortOrder)];
}
export async function getTasks(request: Request, key?: string) {
  await taskAccess(request);
  const data = await readTaskSnapshot();
  if (key !== undefined) return taskJson({ task: findTask(data, key), revision: data.revision });
  const result = board(data), student = new URL(request.url).searchParams.get('studentId');
  if (student !== null) {
    if (!/^[1-9]\d*$/.test(student) || !Number.isSafeInteger(Number(student))) throw new TaskError('Invalid student filter.');
    result.tasks = result.tasks.filter(task => task.student?.id === Number(student));
  }
  return taskJson(result);
}
const editable = ['title', 'description', 'dueDate', 'status', 'studentId'];
export async function createTask(request: Request) {
  const email = await taskAccess(request), input = await taskInput(request, [...editable, 'revision', 'requestKey']);
  const expected = taskRevision(input.revision), fields = manualTaskFields(input);
  if (typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey)) throw new TaskError('A valid creation request key is required.');
  const payload = JSON.stringify({ ...fields, email }), data = await readTaskSnapshot();
  const previous = data.rows.find(task => task.requestKey === input.requestKey);
  if (previous) {
    if (previous.requestPayload !== payload) throw new TaskError('This request key was already used for different task details.', 409);
    return taskJson({ task: serialize(previous), revision: data.revision });
  }
  requireRevision(expected, data.revision);
  const position = board(data).tasks.filter(task => task.status === fields.status).reduce((max, task) => Math.max(max, task.sortOrder + 1), 0), now = new Date().toISOString();
  const result = snapshot(await env.DB.batch([guard(expected), profile(email),
    env.DB.prepare(`INSERT INTO manual_tasks (title, description, due_date, status, student_id, sort_order, created_by, created_at, updated_by, updated_at, request_key, request_payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(fields.title, fields.description, fields.dueDate, fields.status, fields.studentId, position, email, now, email, now, input.requestKey, payload), ...snapshotStatements()]));
  return taskJson({ task: serialize(result.rows.find(task => task.requestKey === input.requestKey)!), revision: result.revision }, 201);
}
export async function updateTask(request: Request, key: string) {
  const email = await taskAccess(request);
  validateKey(key);
  const automatic = key.startsWith('automatic:');
  const allowed = automatic ? ['status', 'studentId', 'dismissed'] : editable;
  const input = await taskInput(request, [...allowed, 'revision']), expected = taskRevision(input.revision), data = await readTaskSnapshot();
  requireRevision(expected, data.revision);
  const current = findTask(data, key), now = new Date().toISOString();
  if (!allowed.some(field => Object.hasOwn(input, field))) throw new TaskError('Choose a task field to update.');
  const status = input.status === undefined ? current.status : taskStatus(input.status);
  const position = status === current.status ? current.sortOrder : board(data).tasks.filter(task => task.status === status).reduce((max, task) => Math.max(max, task.sortOrder + 1), 0);
  const target = taskWhere(current);
  let update: D1PreparedStatement;
  if (automatic) {
    if (input.studentId !== undefined && input.studentId !== null) throw new TaskError('An automatic task can only be unlinked, not assigned to another student.');
    if (input.dismissed !== undefined && typeof input.dismissed !== 'boolean') throw new TaskError('Dismissed must be true or false.');
    update = env.DB.prepare(`UPDATE automatic_task_occurrences SET status = ?, dismissed = ?, student_id = ?, unlinked = CASE WHEN ? THEN 1 ELSE unlinked END, sort_order = ?, updated_by = ?, updated_at = ? WHERE ${target.where}`)
      .bind(status, (input.dismissed ?? current.dismissed) ? 1 : 0, input.studentId === null ? null : current.student?.id ?? null, input.studentId === null ? 1 : 0, position, email, now, ...target.values);
  } else {
    const fields = manualTaskFields(input, { title: current.title, description: current.description, dueDate: current.dueDate, status: current.status, studentId: current.student?.id ?? null });
    update = env.DB.prepare('UPDATE manual_tasks SET title = ?, description = ?, due_date = ?, status = ?, student_id = ?, sort_order = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .bind(fields.title, fields.description, fields.dueDate, fields.status, fields.studentId, position, email, now, manualTaskId(key));
  }
  const result = snapshot(await env.DB.batch([guard(expected), profile(email), ...materialize(current, data, now), update, ...snapshotStatements()]));
  return taskJson({ task: findTask(result, key), revision: result.revision });
}
export async function deleteTask(request: Request, key: string) {
  await taskAccess(request); validateKey(key);
  if (key.startsWith('automatic:')) throw new TaskError('Dismiss this occurrence instead of deleting its state.');
  const id = manualTaskId(key), input = await taskInput(request, ['revision']), expected = taskRevision(input.revision), data = await readTaskSnapshot();
  requireRevision(expected, data.revision); findTask(data, key);
  const result = snapshot(await env.DB.batch([guard(expected), env.DB.prepare('DELETE FROM manual_tasks WHERE id = ?').bind(id), ...snapshotStatements()]));
  return taskJson({ deleted: true, revision: result.revision });
}
export async function moveTask(request: Request) {
  const email = await taskAccess(request), input = await taskInput(request, ['key', 'status', 'position', 'targetKey', 'revision']);
  if (typeof input.key !== 'string') throw new TaskError('A task key is required.');
  validateKey(input.key);
  const status = taskStatus(input.status), expected = taskRevision(input.revision);
  if (typeof input.position !== 'string' || !['before', 'after', 'top', 'bottom'].includes(input.position)) throw new TaskError('Choose before, after, top, or bottom.');
  const relative = input.position === 'before' || input.position === 'after';
  if (relative ? typeof input.targetKey !== 'string' : input.targetKey !== undefined) throw new TaskError('Supply a target task only for before/after moves.');
  if (relative) validateKey(input.targetKey as string);
  if (input.targetKey === input.key) throw new TaskError('A task cannot be moved relative to itself.');
  const data = await readTaskSnapshot(); requireRevision(expected, data.revision);
  const current = findTask(data, input.key);
  const destination = board(data).tasks.filter(task => task.status === status && task.key !== input.key);
  const targetIndex = relative ? destination.findIndex(task => task.key === input.targetKey) : -1;
  if (relative && targetIndex === -1) throw new TaskError('The target task is not in the destination column.', 409);
  const index = input.position === 'top' ? 0 : input.position === 'bottom' ? destination.length : targetIndex + (input.position === 'after' ? 1 : 0);
  destination.splice(index, 0, current);
  const now = new Date().toISOString();
  const reordered = destination.map((task, sortOrder) => ({ task, sortOrder })).filter(({ task, sortOrder }) => task.key === current.key || task.sortOrder !== sortOrder);
  const changes = reordered.flatMap(({ task }) => materialize(task, data, now));
  // Reindex both sources in bounded JSON batches, so a long overdue column
  // does not need one D1 query per task. Only the moved task changes attribution.
  for (const source of ['manual', 'automatic'] as const) {
    const values = reordered.filter(({ task }) => task.source === source).map(({ task, sortOrder }) => ({
      ...(source === 'manual' ? { id: manualTaskId(task.key) } : automaticIdentity(task.key)), sortOrder, moved: task.key === current.key ? 1 : 0,
    }));
    const table = source === 'manual' ? 'manual_tasks' : 'automatic_task_occurrences';
    const where = source === 'manual' ? "task.id = json_extract(item.value, '$.id')" : "task.rule_key = json_extract(item.value, '$.ruleKey') AND task.subject_key = json_extract(item.value, '$.subjectKey') AND task.occurrence_key = json_extract(item.value, '$.occurrenceKey')";
    for (let offset = 0; offset < values.length; offset += 500) changes.push(env.DB.prepare(`UPDATE ${table} AS task
      SET sort_order = json_extract(item.value, '$.sortOrder'),
        status = CASE WHEN json_extract(item.value, '$.moved') = 1 THEN ? ELSE task.status END,
        updated_by = CASE WHEN json_extract(item.value, '$.moved') = 1 THEN ? ELSE task.updated_by END,
        updated_at = CASE WHEN json_extract(item.value, '$.moved') = 1 THEN ? ELSE task.updated_at END
      FROM json_each(?) AS item WHERE ${where}`).bind(status, email, now, JSON.stringify(values.slice(offset, offset + 500))));
  }
  const result = snapshot(await env.DB.batch([guard(expected), profile(email), ...changes, ...snapshotStatements()]));
  return taskJson(board(result));
}
