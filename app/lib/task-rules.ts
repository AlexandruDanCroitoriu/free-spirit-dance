import { birthdayRule } from './task-rules/birthdays';
import { automaticTaskKey, type RuleEvaluation, type RuleSnapshot, type TaskRule } from './task-rules/types';
export * from './task-rules/types';

export const taskRules: readonly TaskRule[] = [birthdayRule];

// Evaluation is pure. Reads can normalize transient candidates without writes;
// retained occurrences and checkpoints are committed together by the server.
export function evaluateTaskRules(snapshot: RuleSnapshot, today: string, activate = false, rules = taskRules): RuleEvaluation {
  const result: RuleEvaluation = { retained: [], calculated: [], updates: [], states: [] };
  const existing = new Map(snapshot.occurrences.map(row => [automaticTaskKey(row), row]));
  for (const rule of rules) {
    const state = snapshot.states.find(state => state.ruleKey === rule.key);
    if (!state && !activate) continue;
    const from = state ? (state.evaluatedOn > today ? today : state.evaluatedOn) : today;
    const activation = state?.activatedOn ?? today;
    const candidates = rule.evaluate({ today, from: from < activation ? activation : from, students: snapshot.students });
    const seen = new Set<string>();
    for (const value of candidates) {
      if (value.ruleKey !== rule.key) throw new Error('Rule returned a mismatched identity.');
      const key = automaticTaskKey(value);
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      (rule.retention === 'occurrence' ? result.retained : result.calculated).push(value);
    }
    for (const row of snapshot.occurrences) {
      if (row.ruleKey !== rule.key || row.status === 'done' || row.dismissed || row.unlinked) continue;
      const refreshed = rule.refresh?.(row, snapshot.students);
      if (refreshed && automaticTaskKey(refreshed) === automaticTaskKey(row) && (refreshed.title !== row.title || refreshed.description !== row.description || refreshed.dueDate !== row.dueDate)) result.updates.push(refreshed);
    }
    if (!state || state.evaluatedOn < today) result.states.push({ ruleKey: rule.key, activatedOn: activation, evaluatedOn: today });
  }
  return result;
}
