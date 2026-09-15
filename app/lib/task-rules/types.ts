import type { BoardTask, TaskStatus } from '../tasks';

export type RuleStudent = { id: number; firstName: string; lastName: string; birthDate: string | null; active: number };
export type RuleState = { ruleKey: string; activatedOn: string; evaluatedOn: string };
export type AutomaticCandidate = { ruleKey: string; subjectKey: string; occurrenceKey: string; studentId: number | null; title: string; description: string; dueDate: string | null };
export type AutomaticOccurrence = AutomaticCandidate & { id: number; unlinked: number; dismissed: number; status: TaskStatus; sortOrder: number; createdBy: string | null; createdAt: string; updatedBy: string | null; updatedAt: string };
export type RuleContext = { today: string; from: string; students: RuleStudent[] };
export type TaskRule = {
  key: string; title: string;
  retention: 'occurrence' | 'state';
  evaluate: (context: RuleContext) => AutomaticCandidate[];
  refresh?: (occurrence: AutomaticOccurrence, students: RuleStudent[]) => AutomaticCandidate | null;
  remapSubject?: (subjectKey: string, studentId: (id: string) => string) => string;
};
export type RuleSnapshot = { students: RuleStudent[]; states: RuleState[]; occurrences: AutomaticOccurrence[] };
export type RuleEvaluation = { retained: AutomaticCandidate[]; calculated: AutomaticCandidate[]; updates: AutomaticCandidate[]; states: RuleState[] };

export function automaticTaskKey(value: Pick<AutomaticCandidate, 'ruleKey' | 'subjectKey' | 'occurrenceKey'>): string {
  return `automatic:${[value.ruleKey, value.subjectKey, value.occurrenceKey].map(encodeURIComponent).join(':')}`;
}
export function normalizeAutomatic(candidate: AutomaticCandidate, students: RuleStudent[], occurrence?: AutomaticOccurrence, sortOrder = 0): BoardTask {
  const student = students.find(student => student.id === candidate.studentId);
  return { key: automaticTaskKey(candidate), source: 'automatic', category: candidate.ruleKey,
    title: candidate.title, description: candidate.description, dueDate: candidate.dueDate,
    status: occurrence?.status ?? 'todo', dismissed: occurrence?.dismissed === 1,
    student: student && !occurrence?.unlinked ? { id: student.id, name: `${student.firstName} ${student.lastName}`.trim() } : null,
    sortOrder: occurrence?.sortOrder ?? sortOrder, canEditContent: false, canDelete: false,
    createdBy: occurrence?.createdBy ?? '', createdAt: occurrence?.createdAt ?? '', updatedBy: occurrence?.updatedBy ?? '', updatedAt: occurrence?.updatedAt ?? '' };
}
