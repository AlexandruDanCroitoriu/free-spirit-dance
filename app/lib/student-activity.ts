export type PaymentCoverage = { classes: { startsAt: string; attended: boolean }[]; remaining: number };

function dateAfterDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export type PaymentLog = { id: number; givenToSchool: number; paidOn: string; amountMinor: number; receivedMethod: string; allocations: { courseId: number; courseName: string; allowance: number }[]; notes: string; recordedBy: string; recordedAt: string };
export type AttendanceLog = { id: number; courseId: number; courseName: string; attendedAt: string; notes: string; recordedBy: string; recordedAt: string | null };
export type ActivitySummary = { eventAttendanceCount?: number; donationsMinor?: number; missedClasses: number; attendanceCount: number; paymentCount: number; paidAllowance: number; remainingAllowance: number; excessAttendance: number; totalPaidMinor: number };
export type StudentActivity = {
  canRecordFuturePayments: boolean;
  logs: { id: number; kind: "attendance" | "payment" | "missed" | "cancelled" | "practice_attendance"; practiceId?: number; voidedAt?: string | null; givenToSchool?: number; receivedMethod?: string; complimentary?: number; complimentaryBy?: string | null; complimentaryAt?: string | null; courseId?: number | null; eventDate: string; courseName: string | null; amountMinor: number | null; notes: string; recordedBy: string; recordedAt: string | null; allocations: { courseId: number; courseName: string; allowance: number; coverage?: PaymentCoverage }[] }[];
  logsPage: number;
  logsPageSize: number;
  logsCount: number;
  summary: ActivitySummary;
  balances: { courseId: number; courseName: string; attendanceCount: number; paidAllowance: number; remainingAllowance: number; excessAttendance: number }[];
  attendance: AttendanceLog[];
  payments: PaymentLog[];
  courses: { id: number; name: string }[];
  paymentMethods: string[];
  attendancePage: number;
  paymentsPage: number;
};
export const activityPageSize = 25;
export const activityLogPageSize = 10;
export const activityLogPageSizes = [10, 20, 30, 40, 50];
export function schoolToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function canRecordFuturePayments(email: string | null) {
  return email?.trim().toLowerCase() === "croitoriu.alexandru.code@gmail.com";
}
export function validPaymentDate(value: unknown, allowFuture = false): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || (!allowFuture && value > schoolToday())) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validPastDate(value: unknown): value is string {
  return validPaymentDate(value);
}
export function parseAmount(value: unknown, allowZero = false): number | null {
  if (typeof value !== "string" || !/^\d{1,6}(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return minor > 0 || (allowZero && minor === 0) ? minor : null;
}
export function formatMoney(minor: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "RON" }).format(minor / 100);
}
export function formatLogDate(value: string) {
  // New class times are recorded in school local time; old ISO timestamps retain their zone.
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:00)?$/.test(value)) {
    const [date, time] = value.split("T");
    return date.split("-").reverse().join("/") + (time ? `, ${time.slice(0, 5)}` : "");
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" }).format(date);
}

// Imported catalogs record absences explicitly. Blank cells are not evidence that
// a student was enrolled, and must not become years of inferred missed classes.
export async function readHistoricalAbsences(db: D1Database, studentId?: number) {
  const exists = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'history_absences'").first();
  if (!exists) return undefined;
  const query = "SELECT CAST(student_id AS INTEGER) AS studentId, CAST(course_id AS INTEGER) AS courseId, class_date || 'T' || start_time AS startsAt FROM history_absences";
  const statement = studentId === undefined ? db.prepare(query) : db.prepare(query + " WHERE CAST(student_id AS INTEGER) = ?").bind(studentId);
  return (await statement.all<{ studentId: number; courseId: number; startsAt: string }>()).results;
}

// Each payment starts at the first attendance on or after its payment date. It
// covers consecutive non-cancelled classes for four weeks from that attendance.
// A payment-date class counts only when the student attended it; an unattended
// same-day class must not create a missed record or consume the new credit.
export function courseCreditBalance(
  course: { courseId: number; courseName: string; startDate: string | null; endDate: string | null },
  schedules: { day: string; startTime: string }[],
  occurrences: { classDate: string; startTime: string; cancelled: number }[],
  payments: { paymentId?: number; paidOn: string; allowance: number; notes?: string | null; coverageStart?: string | null; coverageThrough?: string | null }[],
  attendance: { attendedAt: string; complimentary?: number }[],
  now = new Date(),
  onCoverage?: (paymentId: number, coverage: PaymentCoverage) => void,
  onMissed?: (startsAt: string) => void,
  onCancelled?: (startsAt: string) => void,
  recordedAbsences?: readonly string[],
  onUnpaidAttendance?: (startsAt: string) => void,
  onScheduledClass?: (startsAt: string, attended: boolean) => void,
) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const current = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  const today = current.slice(0, 10);
  const free = new Set(attendance.filter((entry) => entry.complimentary === 1).map((entry) => entry.attendedAt.slice(0, 16)));
  const attended = new Set(attendance.map((entry) => entry.attendedAt.slice(0, 16)));
  const horizon = [today, ...[...attended].map((slot) => slot.slice(0, 10))].sort().at(-1)!;
  // Payments and attendance use the same timeline, including records entered in advance.
  const paymentDate = (payment: (typeof payments)[number]) => {
    const subscriptionStart = payment.coverageStart ?? payment.notes?.match(/subscription starts: (\d{4}-\d{2}-\d{2});/)?.[1];
    return /^\d{4}-\d{2}-\d{2}$/.test(subscriptionStart ?? "") ? subscriptionStart! : payment.paidOn;
  };
  const ordered = [...payments].filter((payment) => paymentDate(payment) <= horizon).sort((a, b) => paymentDate(a).localeCompare(paymentDate(b)) || a.paidOn.localeCompare(b.paidOn));
  const paidAllowance = ordered.reduce((sum, payment) => sum + payment.allowance, 0);
  const slots = new Map<string, boolean>();
  const first = [...ordered.map(paymentDate), ...[...attended, ...(recordedAbsences ?? [])].map((slot) => slot.slice(0, 10))].sort()[0];
  if (first && recordedAbsences === undefined) {
    const start = course.startDate && course.startDate > first ? course.startDate : first;
    // Recompute through the latest recorded attendance or today; retain unused credits.
    const end = course.endDate && course.endDate < horizon ? course.endDate : horizon;
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const date = new Date(start + "T12:00:00Z"); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      for (const schedule of schedules) if (schedule.day === weekdays[date.getUTCDay()]) slots.set(`${date.toISOString().slice(0, 10)}T${schedule.startTime}`, true);
    }
  }
  if (recordedAbsences !== undefined) {
    for (const slot of [...recordedAbsences, ...attended]) slots.set(slot.slice(0, 16), true);
  }
  for (const slot of occurrences) {
    const key = `${slot.classDate}T${slot.startTime}`;
    // Historical blanks are unknown, not absences. Stored occurrences still
    // determine cancellations for explicitly recorded historical activity.
    if (recordedAbsences === undefined || slots.has(key)) slots.set(key, !slot.cancelled);
  }
  for (const slot of attended) if (!slots.has(slot)) slots.set(slot, true);
  // Allocate consecutive classes, including gaps before attendance recorded in advance.
  // Consumption follows today or the latest recorded attendance, whichever is later.
  const held = [...slots].filter(([slot, active]) => active && !free.has(slot) && slot.slice(0, 10) <= horizon).map(([slot]) => slot).sort();
  if (onScheduledClass) for (const slot of held) onScheduledClass(slot, attended.has(slot));
  const covered = new Set<string>();
  const coveredCancellations = new Set<string>();
  for (const payment of ordered) {
    const paymentStart = paymentDate(payment);
    const firstAttendance = held.find((slot) => attended.has(slot) && !covered.has(slot) && slot.slice(0, 10) >= paymentStart);
    // A package begins when the student next attends. Until then, it has not
    // started its one-month validity period and cannot consume missed classes.
    if (!firstAttendance) {
      if (payment.paymentId !== undefined) onCoverage?.(payment.paymentId, { classes: [], remaining: payment.allowance });
      continue;
    }
    const start = firstAttendance.slice(0, 10);
    // A payment covers four calendar weeks of classes. A recorded historical
    // period can shorten that window. Each cancelled session in the window
    // adds the next scheduled session, so cancellations do not shorten the
    // usable attendance period or consume a credit.
    const periodEnd = payment.coverageThrough ? dateAfterDays(payment.coverageThrough, 1) : dateAfterDays(start, 28);
    let windowEnd = [dateAfterDays(start, 28), periodEnd].sort()[0];
    // Historical sheets retain only explicit attendance and absence cells. Keep
    // cancellations and their scheduled replacements separately, so blank cells
    // do not consume credit yet still extend a package's usable period.
    const coverageSlots = new Map(slots);
    const cancelledCount = occurrences.filter((item) => item.cancelled && item.classDate >= start && item.classDate < windowEnd).length;
    const extensionLimit = dateAfterDays(windowEnd, cancelledCount * 14);
    const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const date = new Date(`${windowEnd}T12:00:00Z`); date.toISOString().slice(0, 10) <= extensionLimit; date.setUTCDate(date.getUTCDate() + 1)) {
      const day = date.toISOString().slice(0, 10);
      for (const schedule of schedules) if (schedule.day === weekdayNames[date.getUTCDay()] && (!course.startDate || day >= course.startDate) && (!course.endDate || day <= course.endDate)) coverageSlots.set(`${day}T${schedule.startTime}`, true);
    }
    for (const occurrence of occurrences.filter((item) => item.cancelled)) coverageSlots.set(`${occurrence.classDate}T${occurrence.startTime}`, false);
    let extendedCancellations = 0;
    for (;;) {
      const cancelledInWindow = [...coverageSlots].filter(([slot, active]) => !active && slot >= start && slot.slice(0, 10) < windowEnd).length;
      if (cancelledInWindow <= extendedCancellations) break;
      const replacement = [...coverageSlots].map(([slot]) => slot).filter((slot) => slot.slice(0, 10) >= windowEnd).sort()[0];
      if (!replacement) break;
      windowEnd = dateAfterDays(replacement.slice(0, 10), 1);
      extendedCancellations++;
    }
    let remaining = payment.allowance;
    const classes: PaymentCoverage["classes"] = [];
    for (const slot of held) {
      if (!remaining) break;
      if (slot < start || slot.slice(0, 10) >= windowEnd || covered.has(slot)) continue;
      if (recordedAbsences === undefined && slot.slice(0, 10) === payment.paidOn && !attended.has(slot)) continue;
      covered.add(slot);
      classes.push({ startsAt: slot, attended: attended.has(slot) });
      remaining--;
    }
    // A cancellation belongs in the log only while this package is valid and
    // still has an allowance. Overlapping packages must not duplicate entries.
    if (onCancelled) for (const [slot, active] of coverageSlots) {
      const date = slot.slice(0, 10);
      if (active || slot < firstAttendance || date >= windowEnd) continue;
      if (course.endDate && date > course.endDate) continue;
      if (remaining === 0 && slot > classes.at(-1)!.startsAt) continue;
      coveredCancellations.add(slot);
    }
    if (payment.paymentId !== undefined) onCoverage?.(payment.paymentId, { classes, remaining });
  }
  if (onCancelled) for (const slot of [...coveredCancellations].sort()) onCancelled(slot);
  // Later recorded attendance establishes that earlier covered classes have been passed.
  const attendanceCutoff = [current, ...attended].sort().at(-1)!;
  const used = [...covered].filter((slot) => slot <= attendanceCutoff).length;
  // In historical mode, held slots include only explicit workbook records.
  const missed = [...covered].filter((slot) => slot <= attendanceCutoff && !attended.has(slot));
  if (onMissed) for (const slot of missed) onMissed(slot);
  const missedClasses = missed.length;
  const unpaidAttendance = held.filter((slot) => attended.has(slot) && !covered.has(slot)).length;
  if (onUnpaidAttendance) for (const slot of held) if (attended.has(slot) && !covered.has(slot)) onUnpaidAttendance(slot);
  return { courseId: course.courseId, courseName: course.courseName, attendanceCount: attendance.length, paidAllowance,
    remainingAllowance: paidAllowance - used, missedClasses, excessAttendance: unpaidAttendance };
}
