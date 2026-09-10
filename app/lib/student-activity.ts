export type PaymentCoverage = { classes: { startsAt: string; attended: boolean }[]; remaining: number };
export type PaymentLog = { id: number; paidOn: string; amountMinor: number; allocations: { courseId: number; courseName: string; allowance: number }[]; notes: string; recordedBy: string; recordedAt: string };
export type AttendanceLog = { id: number; courseId: number; courseName: string; attendedAt: string; notes: string; recordedBy: string; recordedAt: string | null };
export type ActivitySummary = { missedClasses: number; attendanceCount: number; paymentCount: number; paidAllowance: number; remainingAllowance: number; excessAttendance: number; totalPaidMinor: number };
export type StudentActivity = {
  logs: { id: number; kind: "attendance" | "payment"; complimentary?: number; complimentaryBy?: string | null; complimentaryAt?: string | null; courseId?: number | null; eventDate: string; courseName: string | null; amountMinor: number | null; notes: string; recordedBy: string; recordedAt: string | null; allocations: { courseId: number; courseName: string; allowance: number; coverage?: PaymentCoverage }[] }[];
  logsPage: number;
  summary: ActivitySummary;
  balances: { courseId: number; courseName: string; attendanceCount: number; paidAllowance: number; remainingAllowance: number; excessAttendance: number }[];
  attendance: AttendanceLog[];
  payments: PaymentLog[];
  courses: { id: number; name: string }[];
  attendancePage: number;
  paymentsPage: number;
};
export const activityPageSize = 25;
export function schoolToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function validPastDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > schoolToday()) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseAmount(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,6}(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return minor > 0 ? minor : null;
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

// Each payment covers consecutive non-cancelled classes from the earliest unpaid attendance.
// Payment dates are date-only, so classes on the payment date are eligible.
export function courseCreditBalance(
  course: { courseId: number; courseName: string; startDate: string | null; endDate: string | null },
  schedules: { day: string; startTime: string }[],
  occurrences: { classDate: string; startTime: string; cancelled: number }[],
  payments: { paymentId?: number; paidOn: string; allowance: number }[],
  attendance: { attendedAt: string; complimentary?: number }[],
  now = new Date(),
  onCoverage?: (paymentId: number, coverage: PaymentCoverage) => void,
) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const current = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  const today = current.slice(0, 10);
  const ordered = [...payments].filter((payment) => payment.paidOn <= today).sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const free = new Set(attendance.filter((entry) => entry.complimentary === 1).map((entry) => entry.attendedAt.slice(0, 16)));
  const attended = new Set(attendance.map((entry) => entry.attendedAt.slice(0, 16)));
  const paidAllowance = ordered.reduce((sum, payment) => sum + payment.allowance, 0);
  const slots = new Map<string, boolean>();
  const first = [...ordered.map((payment) => payment.paidOn), ...[...attended].map((slot) => slot.slice(0, 10))].sort()[0];
  const horizon = [today, ...[...attended].map((slot) => slot.slice(0, 10))].sort().at(-1)!;
  if (first) {
    const start = course.startDate && course.startDate > first ? course.startDate : first;
    // Recompute coverage through today; unused credits remain available for future classes.
    const end = course.endDate && course.endDate < horizon ? course.endDate : horizon;
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const date = new Date(start + "T12:00:00Z"); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      for (const schedule of schedules) if (schedule.day === weekdays[date.getUTCDay()]) slots.set(`${date.toISOString().slice(0, 10)}T${schedule.startTime}`, true);
    }
  }
  for (const slot of occurrences) slots.set(`${slot.classDate}T${slot.startTime}`, !slot.cancelled);
  for (const slot of attended) if (!slots.has(slot)) slots.set(slot, true);
  // Allocate consecutive classes, including gaps before attendance recorded in advance.
  // Consumption follows today or the latest recorded attendance, whichever is later.
  const held = [...slots].filter(([slot, active]) => active && !free.has(slot) && slot.slice(0, 10) <= horizon).map(([slot]) => slot).sort();
  const covered = new Set<string>();
  for (const payment of ordered) {
    const unpaid = held.find((slot) => attended.has(slot) && !covered.has(slot) && slot.slice(0, 10) <= payment.paidOn);
    const start = unpaid ?? payment.paidOn;
    let remaining = payment.allowance;
    const classes: PaymentCoverage["classes"] = [];
    for (const slot of held) {
      if (!remaining) break;
      if (slot < start || covered.has(slot)) continue;
      covered.add(slot);
      classes.push({ startsAt: slot, attended: attended.has(slot) });
      remaining--;
    }
    if (payment.paymentId !== undefined) onCoverage?.(payment.paymentId, { classes, remaining });
  }
  // Later recorded attendance establishes that earlier covered classes have been passed.
  const attendanceCutoff = [current, ...attended].sort().at(-1)!;
  const used = [...covered].filter((slot) => slot <= attendanceCutoff).length;
  const missedClasses = [...covered].filter((slot) => slot <= attendanceCutoff && !attended.has(slot)).length;
  const unpaidAttendance = held.filter((slot) => attended.has(slot) && !covered.has(slot)).length;
  return { courseId: course.courseId, courseName: course.courseName, attendanceCount: attendance.length, paidAllowance,
    remainingAllowance: paidAllowance - used, missedClasses, excessAttendance: unpaidAttendance };
}
