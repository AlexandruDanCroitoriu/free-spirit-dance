import { env } from "../../../../lib/storage";
import { courseCreditBalance, activityPageSize, activityLogPageSize, activityLogPageSizes, parseAmount, validPaymentDate, canRecordFuturePayments, type StudentActivity, type PaymentCoverage } from "../../../../lib/student-activity";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const attendanceColumns = "id, course_id AS courseId, course_name AS courseName, attended_at AS attendedAt, recorded_by AS recordedBy, recorded_at AS recordedAt, notes";
const paymentColumns = "id, paid_on AS paidOn, amount_minor AS amountMinor, given_to_school AS givenToSchool, recorded_by AS recordedBy, recorded_at AS recordedAt, notes";
function page(value: string | null) { const n = Number(value ?? 1); return Number.isSafeInteger(n) && n > 0 && n <= 100000 ? n : null; }
function actor(request: Request) {
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  if (email) return email;
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname) ? "administrator@local" : null;
}

export async function GET(request: Request, context: Context) {
  const id = Number((await context.params).id);
  const url = new URL(request.url);
  const logsPageSize = Number(url.searchParams.get("logsPageSize") ?? activityLogPageSize);
  const logsPage = page(url.searchParams.get("logsPage"));
  const attendancePage = page(url.searchParams.get("attendancePage")), paymentsPage = page(url.searchParams.get("paymentsPage"));
  if (!Number.isSafeInteger(id) || id < 1 || attendancePage === null || paymentsPage === null || logsPage === null || !activityLogPageSizes.includes(logsPageSize)) return json({ error: "Invalid student or page." }, 400);
  try {
    const db = env.DB;
    if (!await db.prepare("SELECT id FROM students WHERE id = ?").bind(id).first()) return json({ error: "Student not found." }, 404);
    const results = await db.batch([
      db.prepare("SELECT c.id AS courseId, c.name AS courseName, c.start_date AS startDate, c.end_date AS endDate FROM courses c WHERE c.id IN (SELECT course_id FROM payment_course_allowances a JOIN student_payments p ON p.id = a.payment_id WHERE p.student_id = ? UNION SELECT course_id FROM attendance WHERE student_id = ?)").bind(id, id),
      db.prepare(`SELECT ${attendanceColumns} FROM attendance WHERE student_id = ? ORDER BY attended_at DESC, id DESC LIMIT ? OFFSET ?`).bind(id, activityPageSize, (attendancePage - 1) * activityPageSize),
      db.prepare(`SELECT ${paymentColumns} FROM student_payments WHERE student_id = ? ORDER BY paid_on DESC, id DESC LIMIT ? OFFSET ?`).bind(id, activityPageSize, (paymentsPage - 1) * activityPageSize),
      db.prepare("SELECT a.payment_id AS paymentId, a.course_id AS courseId, a.course_name AS courseName, a.allowance FROM payment_course_allowances a WHERE a.payment_id IN (SELECT id FROM student_payments WHERE student_id = ? ORDER BY paid_on DESC, id DESC LIMIT ? OFFSET ?) ORDER BY a.course_id").bind(id, activityPageSize, (paymentsPage - 1) * activityPageSize),
      db.prepare("SELECT COUNT(*) AS paymentCount, COALESCE(SUM(amount_minor), 0) AS totalPaidMinor FROM student_payments WHERE student_id = ?").bind(id),
      db.prepare("SELECT id, name FROM courses ORDER BY name COLLATE NOCASE, id"),
      db.prepare(`SELECT * FROM (
        SELECT id, NULL AS givenToSchool, complimentary, complimentary_by AS complimentaryBy, complimentary_at AS complimentaryAt, course_id AS courseId, 'attendance' AS kind, substr(attended_at, 1, 10) AS eventDate, attended_at AS eventTime, course_name AS courseName, NULL AS amountMinor, notes, recorded_by AS recordedBy, recorded_at AS recordedAt, '[]' AS allocations
        FROM attendance WHERE student_id = ?
        UNION ALL
        SELECT p.id, p.given_to_school AS givenToSchool, 0 AS complimentary, NULL AS complimentaryBy, NULL AS complimentaryAt, NULL AS courseId, 'payment', paid_on, paid_on, NULL, amount_minor, notes, recorded_by, recorded_at,
          (SELECT json_group_array(json_object('courseId', a.course_id, 'courseName', a.course_name, 'allowance', a.allowance)) FROM payment_course_allowances a WHERE a.payment_id = p.id)
        FROM student_payments p WHERE student_id = ?
      ) ORDER BY eventDate DESC, eventTime DESC, recordedAt DESC, kind DESC, id DESC LIMIT ? OFFSET ?`).bind(id, id, logsPage * logsPageSize, 0),
    ]);
    const eventRows = await db.prepare(`SELECT a.id, 'practice_attendance' AS kind, s.id AS practiceId, s.starts_at AS eventDate,
      'Practice party' AS courseName, a.donation_amount_minor AS amountMinor,
      a.notes || CASE WHEN a.donation_amount_minor IS NULL THEN '' ELSE ' · Donation: ' || a.donation_notes END AS notes,
      a.recorded_by AS recordedBy, a.recorded_at AS recordedAt, NULL AS voidedAt
      FROM practice_attendance a JOIN practice_parties s ON s.id = a.practice_id WHERE a.student_id = ?
      ORDER BY s.starts_at DESC, a.recorded_at DESC, a.id DESC`).bind(id).all<Omit<StudentActivity["logs"][number], "allocations">>();
    const eventLogs: StudentActivity["logs"] = eventRows.results.map(row => ({ ...row, complimentary: 1, allocations: [] }));
    const creditData = await db.batch([
      db.prepare("SELECT course_id AS courseId, day_of_week AS day, start_time AS startTime FROM course_schedule"),
      db.prepare("SELECT course_id AS courseId, class_date AS classDate, start_time AS startTime, cancelled FROM classes"),
      db.prepare("SELECT p.id AS paymentId, a.course_id AS courseId, p.paid_on AS paidOn, a.allowance FROM payment_course_allowances a JOIN student_payments p ON p.id = a.payment_id WHERE p.student_id = ? ORDER BY p.paid_on, p.id").bind(id),
      db.prepare("SELECT course_id AS courseId, attended_at AS attendedAt, complimentary FROM attendance WHERE student_id = ?").bind(id),
    ]);
    type CourseCredit = Parameters<typeof courseCreditBalance>[0];
    const forCourse = <T,>(index: number, courseId: number) => (creditData[index].results as (T & { courseId: number })[]).filter((row) => row.courseId === courseId);
    const coverage = new Map<string, PaymentCoverage>();
    const calculatedLogs: StudentActivity["logs"] = [];
    const now = new Date();
    const balances = (results[0].results as CourseCredit[]).map((course) => courseCreditBalance(course,
      forCourse<Parameters<typeof courseCreditBalance>[1][number]>(0, course.courseId),
      forCourse<Parameters<typeof courseCreditBalance>[2][number]>(1, course.courseId),
      forCourse<Parameters<typeof courseCreditBalance>[3][number]>(2, course.courseId),
      forCourse<Parameters<typeof courseCreditBalance>[4][number]>(3, course.courseId),
      now,
      (paymentId, detail) => coverage.set(`${paymentId}:${course.courseId}`, detail),
      (startsAt) => calculatedLogs.push({ id: course.courseId, kind: "missed", courseId: course.courseId, courseName: course.courseName, eventDate: `${startsAt}:00`, amountMinor: null, notes: "", recordedBy: "Automatic", recordedAt: null, allocations: [] }),
      (startsAt) => calculatedLogs.push({ id: course.courseId, kind: "cancelled", courseId: course.courseId, courseName: course.courseName, eventDate: `${startsAt}:00`, amountMinor: null, notes: "", recordedBy: "—", recordedAt: null, allocations: [] }),
    )).sort((a, b) => a.courseName.localeCompare(b.courseName));
    const summary: StudentActivity["summary"] = balances.reduce((sum, b) => ({ ...sum, missedClasses: sum.missedClasses + b.missedClasses, attendanceCount: sum.attendanceCount + b.attendanceCount, paidAllowance: sum.paidAllowance + b.paidAllowance, remainingAllowance: sum.remainingAllowance + b.remainingAllowance, excessAttendance: sum.excessAttendance + b.excessAttendance }), { missedClasses: 0, attendanceCount: 0, paidAllowance: 0, remainingAllowance: 0, excessAttendance: 0, ...results[4].results[0] as { paymentCount: number; totalPaidMinor: number } });
    summary.missedClasses = calculatedLogs.filter((row) => row.kind === "missed").length;
    const allocations = results[3].results as { paymentId: number; courseId: number; courseName: string; allowance: number }[];
    const payments = (results[2].results as Omit<StudentActivity["payments"][number], "allocations">[]).map((p) => ({ ...p, allocations: allocations.filter((a) => a.paymentId === p.id).map(({ courseId, courseName, allowance }) => ({ courseId, courseName, allowance })) }));
    const recordedLogs: StudentActivity["logs"] = (results[6].results as (Omit<StudentActivity["logs"][number], "allocations"> & { allocations: string; eventTime: string })[]).map((row) => ({ ...row, eventDate: row.eventTime, allocations: (JSON.parse(row.allocations) as StudentActivity["logs"][number]["allocations"]).map((allocation) => ({ ...allocation, coverage: coverage.get(`${row.id}:${allocation.courseId}`) })) }));
    summary.eventAttendanceCount = eventLogs.filter(r => r.kind === 'practice_attendance' && !r.voidedAt).length;
    summary.donationsMinor = eventLogs.filter(r => r.kind === 'practice_attendance').reduce((sum, r) => sum + (r.amountMinor ?? 0), 0);
    summary.totalPaidMinor += summary.donationsMinor;
    // Merge calculated absences before pagination so no entries are skipped between pages.
    const logs = [...recordedLogs, ...calculatedLogs, ...eventLogs].sort((a, b) =>
      b.eventDate.localeCompare(a.eventDate) || (b.recordedAt ?? "").localeCompare(a.recordedAt ?? "") || b.kind.localeCompare(a.kind) || b.id - a.id,
    ).slice((logsPage - 1) * logsPageSize, logsPage * logsPageSize);
    return json({ canRecordFuturePayments: canRecordFuturePayments(actor(request)), logs, logsPage, logsPageSize, logsCount: summary.attendanceCount + summary.paymentCount + calculatedLogs.length + eventLogs.length, summary, balances, payments, attendance: results[1].results as StudentActivity["attendance"], courses: results[5].results as StudentActivity["courses"], attendancePage, paymentsPage } satisfies StudentActivity);
  } catch (error) {
    console.error("Could not load student activity", error);
    return json({ error: "Could not load attendance and payments." }, 500);
  }
}

export async function POST(request: Request, context: Context) {
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return json({ error: "Invalid student id." }, 400);
  const email = actor(request);
  if (!email) return json({ error: "Sign in to record student activity." }, 401);
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!input || input.kind !== "payment" || typeof input.requestKey !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey) || typeof input.notes !== "string" || input.notes.length > 1000) return json({ error: "Enter a valid record with notes of up to 1,000 characters." }, 400);
  let payload: Record<string, unknown>;
  {
    const amountMinor = parseAmount(input.amount);
    if (amountMinor === null || !validPaymentDate(input.paidOn, canRecordFuturePayments(email)) || !Array.isArray(input.allocations) || input.allocations.length < 1 || input.allocations.length > 100) return json({ error: canRecordFuturePayments(email) ? "Enter a positive RON amount, a valid payment date, and course allowances." : "Enter a positive RON amount, a payment date up to today, and course allowances." }, 400);
    const allocations: { courseId: number; allowance: number }[] = [];
    for (const item of input.allocations) {
      if (!item || !Number.isSafeInteger(item.courseId) || item.courseId < 1 || !Number.isInteger(item.allowance) || item.allowance < 1 || item.allowance > 10000 || allocations.some((a) => a.courseId === item.courseId)) return json({ error: "Select each course once and enter 1–10,000 classes per course." }, 400);
      allocations.push({ courseId: item.courseId, allowance: item.allowance });
    }
    payload = { amountMinor, paidOn: input.paidOn, allocations: allocations.sort((a, b) => a.courseId - b.courseId), notes: input.notes.trim() };
  }
  const table = "student_payments";
  const serialized = JSON.stringify(payload);
  try {
    const db = env.DB;
    if (!await db.prepare("SELECT id FROM students WHERE id = ?").bind(id).first()) return json({ error: "Student not found." }, 404);
    if (request.method === "PATCH") {
      const paymentId = input.paymentId;
      if (typeof paymentId !== "number" || !Number.isSafeInteger(paymentId) || paymentId < 1) return json({ error: "Invalid payment." }, 400);
      if (!await db.prepare("SELECT id FROM student_payments WHERE id = ? AND student_id = ?").bind(paymentId, id).first()) return json({ error: "Payment not found." }, 404);
      await db.batch([
        db.prepare("UPDATE student_payments SET paid_on = ?, amount_minor = ?, notes = ? WHERE id = ? AND student_id = ?").bind(payload.paidOn, payload.amountMinor, payload.notes, paymentId, id),
        db.prepare("DELETE FROM payment_course_allowances WHERE payment_id IN (SELECT id FROM student_payments WHERE id = ? AND student_id = ?)").bind(paymentId, id),
        ...(payload.allocations as { courseId: number; allowance: number }[]).map((a) => db.prepare("INSERT INTO payment_course_allowances (payment_id, course_id, course_name, allowance) VALUES ((SELECT id FROM student_payments WHERE id = ? AND student_id = ?), ?, (SELECT name FROM courses WHERE id = ?), ?)").bind(paymentId, id, a.courseId, a.courseId, a.allowance)),
      ]);
      return json({ id: paymentId });
    }
    const existing = await db.prepare(`SELECT id, student_id, recorded_by, request_payload FROM ${table} WHERE request_key = ?`).bind(input.requestKey).first<{ id: number; student_id: number; recorded_by: string; request_payload: string }>();
    if (existing) return existing.student_id === id && existing.recorded_by === email && existing.request_payload === serialized ? json({ id: existing.id }) : json({ error: "This save was already used for different details. Close the popup and try again." }, 409);
    const statements = [db.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email)];
    {
      statements.push(db.prepare("INSERT INTO student_payments (student_id, paid_on, amount_minor, notes, recorded_by, recorded_at, request_key, request_payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, payload.paidOn, payload.amountMinor, payload.notes, email, new Date().toISOString(), input.requestKey, serialized));
      for (const a of payload.allocations as { courseId: number; allowance: number }[]) {
        // Missing courses fail the NOT NULL/FK constraints, rolling back the payment too.
        statements.push(db.prepare("INSERT INTO payment_course_allowances (payment_id, course_id, course_name, allowance) VALUES ((SELECT id FROM student_payments WHERE request_key = ?), ?, (SELECT name FROM courses WHERE id = ?), ?)").bind(input.requestKey, a.courseId, a.courseId, a.allowance));
      }
    }
    statements.push(db.prepare(`SELECT id FROM ${table} WHERE request_key = ?`).bind(input.requestKey));
    const result = await db.batch(statements);
    return json(result.at(-1)!.results[0], 201);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return json({ error: "This record may already be saved, or this class attendance is already recorded. Retry to confirm the save or reload the log." }, 409);
    if (/FOREIGN KEY|NOT NULL/.test(String(error))) return json({ error: "The student or a selected course no longer exists. Reload and try again." }, 409);
    console.error("Could not record student activity", error);
    return json({ error: "Could not confirm the save. Retry with the same details to avoid a duplicate." }, 500);
  }
}


export const PATCH = POST;

export async function DELETE(request: Request, context: Context) {
  const id = Number((await context.params).id);
  if (!actor(request)) return json({ error: "Sign in to delete a payment." }, 401);
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!Number.isSafeInteger(id) || id < 1 || typeof input?.paymentId !== "number" || !Number.isSafeInteger(input.paymentId) || input.paymentId < 1) return json({ error: "Invalid student or payment." }, 400);
  try {
    const db = env.DB;
    await db.batch([
      db.prepare("DELETE FROM payment_course_allowances WHERE payment_id IN (SELECT id FROM student_payments WHERE id = ? AND student_id = ?)").bind(input.paymentId, id),
      db.prepare("DELETE FROM student_payments WHERE id = ? AND student_id = ?").bind(input.paymentId, id),
    ]);
    return json({ deleted: true });
  } catch (error) {
    console.error("Could not delete payment", error);
    return json({ error: "Could not delete payment. Please retry." }, 500);
  }
}
