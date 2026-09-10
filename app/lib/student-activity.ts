export type PaymentLog = { id: number; paidOn: string; amountMinor: number; allocations: { courseId: number; courseName: string; allowance: number }[]; notes: string; recordedBy: string; recordedAt: string };
export type AttendanceLog = { id: number; courseId: number; courseName: string; attendedAt: string; notes: string; recordedBy: string; recordedAt: string | null };
export type ActivitySummary = { attendanceCount: number; paymentCount: number; paidAllowance: number; remainingAllowance: number; excessAttendance: number; totalPaidMinor: number };
export type StudentActivity = {
  logs: { id: number; kind: "attendance" | "payment"; eventDate: string; courseName: string | null; amountMinor: number | null; notes: string; recordedBy: string; recordedAt: string | null; allocations: { courseId: number; courseName: string; allowance: number }[] }[];
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

// Credits first settle unpaid attendance, then cover consecutive non-cancelled classes.
// Payment dates are date-only, so classes on the payment date are eligible.
export function courseCreditBalance(
  course: { courseId: number; courseName: string; startDate: string | null; endDate: string | null },
  schedules: { day: string; startTime: string }[],
  occurrences: { classDate: string; startTime: string; cancelled: number }[],
  payments: { paidOn: string; allowance: number }[],
  attendance: { attendedAt: string }[],
  now = new Date(),
) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const current = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  const ordered = [...payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const slots = new Map<string, boolean>();
  const first = ordered[0]?.paidOn;
  if (first) {
    const start = course.startDate && course.startDate > first ? course.startDate : first;
    const end = course.endDate && course.endDate < current.slice(0, 10) ? course.endDate : current.slice(0, 10);
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    for (const date = new Date(start + "T12:00:00Z"); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      for (const schedule of schedules) if (schedule.day === weekdays[date.getUTCDay()]) slots.set(`${date.toISOString().slice(0, 10)}T${schedule.startTime}`, true);
    }
  }
  // Persisted occurrences override recurrence, including cancellations and old schedules.
  for (const slot of occurrences) slots.set(`${slot.classDate}T${slot.startTime}`, !slot.cancelled);
  const attended = new Set(attendance.map((a) => a.attendedAt.slice(0, 16)));
  // Include attendance before the first payment, even without a persisted occurrence.
  for (const slot of attended) if (!slots.has(slot)) slots.set(slot, true);
  let available = 0, paymentIndex = 0, used = 0, unpaidAttendance = 0;
  function applyPayments(date: string) {
    while (paymentIndex < ordered.length && ordered[paymentIndex].paidOn <= date) available += ordered[paymentIndex++].allowance;
    const settled = Math.min(available, unpaidAttendance);
    available -= settled;
    unpaidAttendance -= settled;
    used += settled;
  }
  for (const [slot, held] of [...slots].sort(([a], [b]) => a.localeCompare(b))) {
    if (slot > current) continue;
    applyPayments(slot.slice(0, 10));
    if (!held) continue;
    if (available > 0) { available--; used++; }
    else if (attended.has(slot)) unpaidAttendance++;
  }
  // A payment settles debt immediately, even before another class takes place.
  applyPayments(current.slice(0, 10));
  const paidAllowance = ordered.reduce((sum, p) => sum + p.allowance, 0);
  return { courseId: course.courseId, courseName: course.courseName, attendanceCount: attendance.length, paidAllowance, remainingAllowance: paidAllowance - used,
    excessAttendance: unpaidAttendance };
}
