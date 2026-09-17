import { env } from "../../lib/storage";
import { courseCreditBalance, resolveSharedPaymentStarts, validPaymentDate } from "../../lib/student-activity";

type CalendarEvent = { date: string; kind: "attendance" | "missed" | "free_missed" | "payment"; courseName: string | null; count: number; paymentId: number | null; complimentary: number; coveredClasses?: { courseName: string; startsAt: string }[] };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const studentId = Number(url.searchParams.get("studentId"));
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const maximumDays = url.searchParams.get("all") === "true" ? 200 * 366 : 370;
  if (!Number.isInteger(studentId) || studentId < 1 || !validPaymentDate(from, true) || !validPaymentDate(to, true) || from > to || Date.parse(to) - Date.parse(from) > maximumDays * 86400000) {
    return Response.json({ error: `Choose a student and a calendar range of up to ${maximumDays} days.` }, { status: 400 });
  }
  try {
    if (!await env.DB.prepare("SELECT id FROM students WHERE id = ?").bind(studentId).first()) return Response.json({ error: "Student not found." }, { status: 404 });
    const hasHistoricalPaymentPeriods = Boolean(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'history_payment_periods'").first());
    const coverageThrough = hasHistoricalPaymentPeriods
      ? "(SELECT coverage_through FROM history_payment_periods hp WHERE CAST(hp.review_payment_id AS INTEGER) = p.id LIMIT 1)"
      : "NULL";
    const [result, coursesResult, schedulesResult, occurrencesResult, paymentsResult, attendanceResult, freeMissedResult] = await Promise.all([
      env.DB.prepare(`
      WITH activity AS (
        SELECT substr(attended_at, 1, 10) AS date, 'attendance' AS kind, course_name AS courseName, COUNT(*) AS count, NULL AS paymentId, MAX(complimentary) AS complimentary
          FROM attendance WHERE student_id = ? GROUP BY date, course_id, course_name
        UNION ALL SELECT paid_on, 'payment', NULL, 1, id, 0
          FROM student_payments WHERE id IN (SELECT payment_id FROM student_payment_coverage WHERE student_id = ?)
      ) SELECT date, kind, courseName, count, paymentId, complimentary FROM activity WHERE date BETWEEN ? AND ? ORDER BY date, kind, courseName`).bind(studentId, studentId, from, to).all<CalendarEvent>(),
      env.DB.prepare("SELECT id AS courseId, name AS courseName, start_date AS startDate, end_date AS endDate FROM courses").all<{ courseId: number; courseName: string; startDate: string | null; endDate: string | null }>(),
      env.DB.prepare("SELECT course_id AS courseId, day_of_week AS day, start_time AS startTime FROM course_schedule").all<{ courseId: number; day: string; startTime: string }>(),
      env.DB.prepare("SELECT course_id AS courseId, class_date AS classDate, start_time AS startTime, cancelled FROM classes").all<{ courseId: number; classDate: string; startTime: string; cancelled: number }>(),
      env.DB.prepare(`SELECT p.id AS paymentId, a.course_id AS courseId, a.course_name AS courseName, p.paid_on AS paidOn, a.allowance, p.notes, ${coverageThrough} AS coverageThrough FROM payment_course_allowances a JOIN student_payments p ON p.id = a.payment_id JOIN student_payment_coverage pc ON pc.payment_id = p.id WHERE pc.student_id = ? ORDER BY p.paid_on, p.id`).bind(studentId).all<{ paymentId: number; courseId: number; courseName: string; paidOn: string; allowance: number; notes: string | null; coverageThrough: string | null }>(),
      env.DB.prepare("SELECT course_id AS courseId, attended_at AS attendedAt, complimentary FROM attendance WHERE student_id = ?").bind(studentId).all<{ courseId: number; attendedAt: string; complimentary: number }>(),
      env.DB.prepare("SELECT cl.course_id AS courseId, cl.class_date || 'T' || cl.start_time AS startsAt, c.name AS courseName FROM free_missed_attendance f JOIN classes cl ON cl.id = f.class_id JOIN courses c ON c.id = cl.course_id WHERE f.student_id = ?").bind(studentId).all<{ courseId: number; startsAt: string; courseName: string }>(),
    ]);
    const coverage = new Map<number, { courseName: string; startsAt: string }[]>();
    const missed = new Map<string, CalendarEvent>();
    const now = new Date();
    const creditCourses = coursesResult.results.map((course) => ({
      course,
      schedules: schedulesResult.results.filter((item) => item.courseId === course.courseId),
      occurrences: occurrencesResult.results.filter((item) => item.courseId === course.courseId),
      payments: paymentsResult.results.filter((item) => item.courseId === course.courseId),
      attendance: attendanceResult.results.filter((item) => item.courseId === course.courseId),
      freeMissed: freeMissedResult.results.filter((item) => item.courseId === course.courseId).map((item) => item.startsAt),
    }));
    const sharedPaymentStarts = resolveSharedPaymentStarts(creditCourses, now);
    for (const item of creditCourses) courseCreditBalance(item.course,
      item.schedules, item.occurrences,
      item.payments.map((payment) => ({ ...payment, coverageStart: sharedPaymentStarts.get(payment.paymentId) })),
      item.attendance, now,
      (paymentId, detail) => coverage.set(paymentId, [...(coverage.get(paymentId) ?? []), ...detail.classes.map((covered) => ({ courseName: item.course.courseName, startsAt: covered.startsAt }))]),
      (startsAt) => {
        const date = startsAt.slice(0, 10);
        if (date < from || date > to) return;
        const key = `${date}:${item.course.courseId}`;
        const previous = missed.get(key);
        missed.set(key, { date, kind: "missed", courseName: item.course.courseName, count: (previous?.count ?? 0) + 1, paymentId: null, complimentary: 0 });
      },
      undefined,
      undefined,
      undefined,
      item.freeMissed,
    );
    const freeMissedEvents = freeMissedResult.results.filter((item) => item.startsAt.slice(0, 10) >= from && item.startsAt.slice(0, 10) <= to).map((item) => ({ date: item.startsAt.slice(0, 10), kind: "free_missed" as const, courseName: item.courseName, count: 1, paymentId: null, complimentary: 1 }));
    const events = [...result.results, ...missed.values(), ...freeMissedEvents]
      .map((event) => event.kind === "payment" && event.paymentId !== null ? { ...event, coveredClasses: coverage.get(event.paymentId) ?? [] } : event)
      .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || (a.courseName ?? "").localeCompare(b.courseName ?? ""));
    return Response.json({ events }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load student calendar", error);
    return Response.json({ error: "Could not load student calendar." }, { status: 500 });
  }
}
