export type PaymentCoverage = { classes: { startsAt: string; attended: boolean }[]; remaining: number };
type CreditCourse = {
  course: Parameters<typeof courseCreditBalance>[0];
  schedules: Parameters<typeof courseCreditBalance>[1];
  occurrences: Parameters<typeof courseCreditBalance>[2];
  payments: Parameters<typeof courseCreditBalance>[3];
  attendance: Parameters<typeof courseCreditBalance>[4];
  freeMissed?: readonly string[];
};

function dateAfterDays(day: string, days: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export type PaymentStudent = { id: number; firstName: string; lastName: string; picture: string | null };
export type GroupPaymentDetails = { studentCount?: number; payer?: PaymentStudent; students?: PaymentStudent[] };
export type PaymentLog = GroupPaymentDetails & { id: number; givenToSchool: number; paidOn: string; amountMinor: number; receivedMethod: string; allocations: { courseId: number; courseName: string; allowance: number }[]; notes: string; recordedBy: string; recordedAt: string };
export type AttendanceLog = { id: number; courseId: number; courseName: string; attendedAt: string; notes: string; recordedBy: string; recordedAt: string | null };
export type ActivitySummary = { eventAttendanceCount?: number; donationsMinor?: number; missedClasses: number; attendanceCount: number; paymentCount: number; paidAllowance: number; remainingAllowance: number; excessAttendance: number; totalPaidMinor: number };
export type StudentActivity = {
  canRecordFuturePayments: boolean;
  logs: (GroupPaymentDetails & { id: number; kind: "attendance" | "payment" | "missed" | "free_missed" | "cancelled" | "practice_attendance"; practiceId?: number; voidedAt?: string | null; givenToSchool?: number; receivedMethod?: string; complimentary?: number; complimentaryBy?: string | null; complimentaryAt?: string | null; courseId?: number | null; eventDate: string; courseName: string | null; amountMinor: number | null; notes: string; recordedBy: string; recordedAt: string | null; allocations: { courseId: number; courseName: string; allowance: number; coverage?: PaymentCoverage }[] })[];
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

// A subscription payment can settle the first unpaid attendance in the four
// weeks before it was paid. It covers consecutive non-cancelled classes for
// four weeks from that attendance.
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
  onUnpaidAttendance?: (startsAt: string) => void,
  onScheduledClass?: (startsAt: string, attended: boolean) => void,
  freeMissed?: readonly string[],
) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const current = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  const today = current.slice(0, 10);
  const free = new Set(attendance.filter((entry) => entry.complimentary === 1).map((entry) => entry.attendedAt.slice(0, 16)));
  const freeMissedSlots = new Set(freeMissed?.map((slot) => slot.slice(0, 16)) ?? []);
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
  const first = [...ordered.map(paymentDate), ...[...attended].map((slot) => slot.slice(0, 10))].sort()[0];
  if (first) {
    const start = course.startDate && course.startDate > first ? course.startDate : first;
    // Recompute through the latest recorded attendance or today; retain unused credits.
    const end = course.endDate && course.endDate < horizon ? course.endDate : horizon;
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    // A recorded class is the historical source of truth for that course/day.
    // Weekly schedules describe the current recurring timetable and may have
    // changed since the class was held; generating them alongside an imported
    // occurrence creates a phantom class at the new time/day.
    const recordedOccurrenceDates = new Set(occurrences.map((occurrence) => occurrence.classDate));
    for (const date = new Date(start + "T12:00:00Z"); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      const day = date.toISOString().slice(0, 10);
      if (recordedOccurrenceDates.has(day)) continue;
      for (const schedule of schedules) if (schedule.day === weekdays[date.getUTCDay()]) slots.set(`${day}T${schedule.startTime}`, true);
    }
  }
  for (const slot of occurrences) {
    slots.set(`${slot.classDate}T${slot.startTime}`, !slot.cancelled);
  }
  for (const slot of attended) if (!slots.has(slot)) slots.set(slot, true);
  // Allocate consecutive classes, including gaps before attendance recorded in advance.
  // Consumption follows today or the latest recorded attendance, whichever is later.
  const held = [...slots].filter(([slot, active]) => active && !free.has(slot) && !freeMissedSlots.has(slot) && slot.slice(0, 10) <= horizon).map(([slot]) => slot).sort();
  if (onScheduledClass) for (const slot of held) onScheduledClass(slot, attended.has(slot));
  const covered = new Set<string>();
  const coveredCancellations = new Set<string>();
  for (const payment of ordered) {
    const paymentStart = paymentDate(payment);
    const earliestEligibleAttendance = dateAfterDays(paymentStart, -28);
    const sharedStart = /^\d{4}-\d{2}-\d{2}$/.test(payment.coverageStart ?? "") ? payment.coverageStart! : undefined;
    const priorAttendance = sharedStart
      ? held.find((slot) => slot.slice(0, 10) >= sharedStart && !covered.has(slot))
      : held.find((slot) => attended.has(slot) && !covered.has(slot) && slot.slice(0, 10) >= earliestEligibleAttendance && slot.slice(0, 10) <= paymentStart);
    // A payment made between classes starts at the next recorded attendance
    // when it has no eligible attendance to settle. A missed class does not
    // activate a single-course payment by itself.
    const firstAttendance = priorAttendance ?? (!sharedStart ? held.find((slot) => attended.has(slot) && slot.slice(0, 10) > paymentStart && !covered.has(slot)) : undefined);
    // A package starts with an eligible unpaid attendance or the next recorded
    // attendance. It cannot consume missed classes before that point.
    if (!firstAttendance) {
      if (payment.paymentId !== undefined) onCoverage?.(payment.paymentId, { classes: [], remaining: payment.allowance });
      continue;
    }
    const start = sharedStart ?? firstAttendance.slice(0, 10);
    // A payment covers four calendar weeks of classes. A recorded historical
    // period can shorten that window. Each cancelled session in the window
    // adds the next scheduled session, so cancellations do not shorten the
    // usable attendance period or consume a credit.
    const periodEnd = payment.coverageThrough ? dateAfterDays(payment.coverageThrough, 1) : dateAfterDays(start, 28);
    let windowEnd = [dateAfterDays(start, 28), periodEnd].sort()[0];
    // Keep cancellations and their scheduled replacements so cancelled classes
    // extend the package's usable period without consuming credit.
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
      if (!sharedStart && slot.slice(0, 10) === payment.paidOn && !attended.has(slot)) continue;
      covered.add(slot);
      classes.push({ startsAt: slot, attended: attended.has(slot) });
      remaining--;
    }
    // A cancellation belongs in the log only while this package is valid and
    // still has an allowance. Overlapping packages must not duplicate entries.
    if (onCancelled) for (const [slot, active] of coverageSlots) {
      const date = slot.slice(0, 10);
      if (active || slot.slice(0, 10) < start || date >= windowEnd) continue;
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
  // A missed class must be covered by a payment and belong to a valid calendar
  // slot. Recorded occurrences override the current weekly timetable.
  const missed = [...covered].filter((slot) => slot <= attendanceCutoff && !attended.has(slot));
  if (onMissed) for (const slot of missed) onMissed(slot);
  const missedClasses = missed.length;
  const unpaidAttendance = held.filter((slot) => attended.has(slot) && !covered.has(slot)).length;
  if (onUnpaidAttendance) for (const slot of held) if (attended.has(slot) && !covered.has(slot)) onUnpaidAttendance(slot);
  return { courseId: course.courseId, courseName: course.courseName, attendanceCount: attendance.length, paidAllowance,
    remainingAllowance: paidAllowance - used, missedClasses, excessAttendance: unpaidAttendance };
}

// A payment with allocations for several courses is one subscription. Its
// latest uncovered attendance on or before payment starts the shared window.
// If none exists, it begins at the first later recorded attendance.
export function resolveSharedPaymentStarts(courses: CreditCourse[], now = new Date()) {
  const payments = new Map<number, { paidOn: string; courseIds: Set<number> }>();
  for (const item of courses) for (const payment of item.payments) {
    if (payment.paymentId === undefined) continue;
    const entry = payments.get(payment.paymentId) ?? { paidOn: payment.paidOn, courseIds: new Set<number>() };
    entry.courseIds.add(item.course.courseId);
    payments.set(payment.paymentId, entry);
  }
  const starts = new Map<number, string>();
  const ordered = [...payments].sort(([, first], [, second]) => first.paidOn.localeCompare(second.paidOn));
  for (const [paymentId, payment] of ordered) {
    if (payment.courseIds.size < 2) continue;
    let latestEligible: string | undefined;
    let firstLater: string | undefined;
    for (const item of courses.filter((course) => payment.courseIds.has(course.course.courseId))) {
      const eligiblePayments = item.payments
        .filter((candidate) => candidate.paymentId !== undefined && payments.has(candidate.paymentId))
        .filter((candidate) => candidate.paidOn < payment.paidOn || candidate.paymentId === paymentId || (candidate.paymentId !== undefined && starts.has(candidate.paymentId)))
        .map((candidate) => candidate.paymentId === undefined ? candidate : { ...candidate, coverageStart: starts.get(candidate.paymentId) ?? candidate.coverageStart });
      courseCreditBalance(item.course, item.schedules, item.occurrences, eligiblePayments, item.attendance, now,
        (id, detail) => {
          if (id !== paymentId || !detail.classes.length) return;
          const date = detail.classes[0].startsAt.slice(0, 10);
          if (date <= payment.paidOn) {
            if (!latestEligible || date > latestEligible) latestEligible = date;
          } else if (!firstLater || date < firstLater) firstLater = date;
        }, undefined, undefined, undefined, undefined, item.freeMissed);
    }
    const start = latestEligible ?? firstLater;
    if (start) starts.set(paymentId, start);
  }
  return starts;
}
