import { addCalendarDays, birthdayInYear, validCalendarDate } from '../task-dates';
import type { AutomaticCandidate, RuleStudent, TaskRule } from './types';

function candidate(student: RuleStudent, year: number): AutomaticCandidate | null {
  const dueDate = student.birthDate && birthdayInYear(student.birthDate, year);
  if (!dueDate) return null;
  return { ruleKey: 'birthday', subjectKey: `student:${student.id}`, occurrenceKey: String(year).padStart(4, '0'), studentId: student.id,
    title: `Birthday: ${student.firstName} ${student.lastName}`.trim().slice(0, 200), description: 'Wish this student a happy birthday.', dueDate };
}
export const birthdayRule: TaskRule = {
  key: 'birthday', title: 'Student Birthdays', retention: 'occurrence',
  remapSubject: (key, mapStudent) => key.startsWith('student:') ? `student:${mapStudent(key.slice(8))}` : key,
  evaluate({ today, from, students }) {
    const end = addCalendarDays(today, 30), result: AutomaticCandidate[] = [];
    for (const student of students) {
      if (!student.active || !student.birthDate || !validCalendarDate(student.birthDate) || student.birthDate > today) continue;
      for (let year = Number(from.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
        const value = candidate(student, year);
        if (value?.dueDate && value.dueDate >= from && value.dueDate <= end) result.push(value);
      }
    }
    return result;
  },
  refresh(occurrence, students) {
    // A subject key is a deduplication marker, never a way to re-link a student.
    if (occurrence.unlinked || occurrence.studentId === null || !/^\d{4}$/.test(occurrence.occurrenceKey)) return null;
    const student = students.find(student => student.id === occurrence.studentId);
    return student ? candidate(student, Number(occurrence.occurrenceKey)) : null;
  },
};
