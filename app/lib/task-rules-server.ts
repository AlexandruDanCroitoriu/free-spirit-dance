import { env } from './storage';
import { schoolToday } from './tasks';
import { evaluateTaskRules, automaticTaskKey, type RuleEvaluation, type RuleStudent, type AutomaticOccurrence } from './task-rules';
import { board, guard, insertOccurrence, readTaskSnapshot, snapshot, snapshotStatements, taskAccess, taskInput, taskJson, type TaskSnapshot } from './tasks-server';

function synchronizationStatements(evaluation: RuleEvaluation, now: string) {
  return [
    // JSON bindings keep catch-up within D1's query/parameter limits even when
    // many students became eligible since the last visit. All writes remain in
    // the same guarded transaction as the checkpoint.
    ...chunks(evaluation.retained).map(values => env.DB.prepare(`INSERT INTO automatic_task_occurrences
      (rule_key, subject_key, occurrence_key, student_id, title, description, due_date, sort_order, created_at, updated_at)
      SELECT json_extract(value, '$.ruleKey'), json_extract(value, '$.subjectKey'), json_extract(value, '$.occurrenceKey'),
        json_extract(value, '$.studentId'), json_extract(value, '$.title'), json_extract(value, '$.description'), json_extract(value, '$.dueDate'),
        (SELECT COALESCE(MAX(sort_order), -1) FROM (SELECT sort_order FROM manual_tasks WHERE status = 'todo' UNION ALL SELECT sort_order FROM automatic_task_occurrences WHERE status = 'todo')) + CAST(key AS INTEGER) + 1, ?, ?
      FROM json_each(?) WHERE 1 ON CONFLICT(rule_key, subject_key, occurrence_key) DO NOTHING`)
      .bind(now, now, JSON.stringify(values))),
    ...chunks(evaluation.updates).map(values => env.DB.prepare(`UPDATE automatic_task_occurrences AS occurrence
      SET title = json_extract(candidate.value, '$.title'), description = json_extract(candidate.value, '$.description'),
        due_date = json_extract(candidate.value, '$.dueDate'), updated_at = ?
      FROM json_each(?) AS candidate
      WHERE occurrence.rule_key = json_extract(candidate.value, '$.ruleKey') AND occurrence.subject_key = json_extract(candidate.value, '$.subjectKey')
        AND occurrence.occurrence_key = json_extract(candidate.value, '$.occurrenceKey') AND occurrence.status != 'done' AND occurrence.dismissed = 0 AND occurrence.unlinked = 0`)
      .bind(now, JSON.stringify(values))),
    ...evaluation.states.map(state => env.DB.prepare(`INSERT INTO task_rule_state(rule_key, activated_on, evaluated_on) VALUES (?, ?, ?)
      ON CONFLICT(rule_key) DO UPDATE SET evaluated_on = excluded.evaluated_on WHERE task_rule_state.evaluated_on < excluded.evaluated_on`)
      .bind(state.ruleKey, state.activatedOn, state.evaluatedOn)),
  ];
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += 500) result.push(values.slice(offset, offset + 500));
  return result;
}

export async function synchronizeTaskRules(activate = false, now = new Date()) {
  const today = schoolToday(now);
  for (let attempt = 0; ; attempt++) {
    const data = await readTaskSnapshot();
    const changes = synchronizationStatements(evaluateTaskRules(data, today, activate), now.toISOString());
    if (!changes.length) return board(data, today);
    try { return board(snapshot(await env.DB.batch([guard(data.revision), ...changes, ...snapshotStatements()])), today); }
    catch (error) { if (attempt >= 2 || !String(error).includes('Task board changed')) throw error; }
  }
}

export async function refreshTasks(request: Request) {
  await taskAccess(request);
  await taskInput(request, []);
  return taskJson(await synchronizeTaskRules(true));
}

function afterEvaluation(data: TaskSnapshot, evaluation: RuleEvaluation, now: string): TaskSnapshot {
  const updates = new Map(evaluation.updates.map(value => [automaticTaskKey(value), value]));
  const retained: AutomaticOccurrence[] = evaluation.retained.map(value => ({ ...value, id: 0, unlinked: 0, dismissed: 0, status: 'todo', sortOrder: 0, createdBy: null, updatedBy: null, createdAt: now, updatedAt: now }));
  return { ...data, occurrences: [...data.occurrences.map(row => ({ ...row, ...updates.get(automaticTaskKey(row)) })), ...retained],
    states: data.states.map(state => evaluation.states.find(next => next.ruleKey === state.ruleKey) ?? state) };
}

// Reconcile previous eligibility and update the student in one guarded batch.
// A new student uses id=0 only inside this projection; inserts resolve the real
// SQLite students sequence after the existing student/course insert statements.
export async function studentTaskMutation<T>(statements: D1PreparedStatement[], replacement?: RuleStudent, now = new Date()): Promise<D1Result<T>[]> {
  const data = await readTaskSnapshot(), today = schoolToday(now), timestamp = now.toISOString();
  const evaluation = evaluateTaskRules(data, today);
  const prefix = [guard(data.revision), ...synchronizationStatements(evaluation, timestamp)];
  const suffix: D1PreparedStatement[] = [];
  if (replacement) {
    const projected = afterEvaluation(data, evaluation, timestamp);
    projected.students = [...data.students.filter(student => student.id !== replacement.id), replacement];
    // Only current/upcoming eligibility under new data; never infer the old
    // birth date or active state for a newly entered/reactivated student.
    projected.states = projected.states.map(state => ({ ...state, evaluatedOn: today }));
    const next = evaluateTaskRules(projected, today);
    if (replacement.id === 0) {
      suffix.push(...next.retained.filter(value => value.studentId === 0).map(value => insertOccurrence(value, timestamp, null, null, true)));
    } else suffix.push(...synchronizationStatements(next, timestamp));
  }
  const result = await env.DB.batch<T>([...prefix, ...statements, ...suffix]);
  return result.slice(prefix.length, prefix.length + statements.length);
}
