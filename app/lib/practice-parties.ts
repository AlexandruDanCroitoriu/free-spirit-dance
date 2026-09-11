import { validPaymentDate } from './student-activity';

export type PracticeSession = { id: number; startsAt: string; startsUtc: string; durationMinutes: number; cancelled: number; revision: number; attendanceCount: number };
export type EventStudent = { id: number; firstName: string; lastName: string; email: string | null; picture: string | null; active: number; attendanceId: number | null };
export type EventPayment = { id: number; studentId: number; studentName: string; practiceId: number; amountMinor: number; paidOn: string; notes: string; recordedBy: string; givenToSchool: number };
export type EventDetail = { party: PracticeSession; payments: EventPayment[]; totals: { receivedMinor: number; givenMinor: number; pendingMinor: number }; changes: { id: number; reason: string; beforeJson: string; afterJson: string; recordedBy: string; recordedAt: string }[] };
export const eventButton = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-sans disabled:opacity-50 hover:border-lime-600';
export const eventPrimary = eventButton + ' bg-lime-100 text-lime-900';
export const eventInput = 'mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm font-normal text-slate-800';
export function localTime(instant: string | Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const p = (kind: string) => parts.find(x => x.type === kind)!.value;
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}`;
}
export function sessionEnd(session: { startsUtc: string; durationMinutes: number }) {
  return localTime(new Date(Date.parse(session.startsUtc) + session.durationMinutes * 60000));
}
export function parseSession(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Enter session details.');
  const v = value as Record<string, unknown>;
  if (!validPaymentDate(v.date, true) || typeof v.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v.time)) throw new Error('Enter a valid session date and time.');
  if (!Number.isInteger(v.durationMinutes) || Number(v.durationMinutes) < 1 || Number(v.durationMinutes) > 1440) throw new Error('Duration must be 1–1,440 whole minutes.');
  const startsAt = `${v.date}T${v.time}`;
  // Resolve the local wall time without relying on the browser/server timezone.
  const naive = Date.parse(startsAt + ':00Z');
  const candidates = [120, 180].map(offset => new Date(naive - offset * 60000).toISOString()).filter(instant => localTime(instant) === startsAt);
  if (!candidates.length) throw new Error('This local time does not exist due to daylight saving. Choose another time.');
  if (candidates.length > 1 && v.offset !== 'summer' && v.offset !== 'winter') throw new Error('This time occurs twice. Choose summer or winter time.');
  const startsUtc = candidates.length === 1 ? candidates[0] : candidates[v.offset === 'winter' ? 0 : 1];
  return { startsAt, startsUtc, durationMinutes: Number(v.durationMinutes) };
}
