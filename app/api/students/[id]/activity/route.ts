import { env } from "../../../../lib/storage";
import { courseCreditBalance, resolveSharedPaymentStarts, activityPageSize, activityLogPageSize, activityLogPageSizes, parseAmount, validPaymentDate, canRecordFuturePayments, type StudentActivity, type PaymentCoverage } from "../../../../lib/student-activity";
import { practiceNoteForDisplay } from "../../../../lib/practice-parties";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const attendanceColumns = "id, course_id AS courseId, course_name AS courseName, attended_at AS attendedAt, recorded_by AS recordedBy, recorded_at AS recordedAt, notes";
const paymentColumns = "id, paid_on AS paidOn, amount_minor AS amountMinor, received_method AS receivedMethod, given_to_school AS givenToSchool, recorded_by AS recordedBy, recorded_at AS recordedAt, notes";
function page(value: string | null) { const n = Number(value ?? 1); return Number.isSafeInteger(n) && n > 0 && n <= 100000 ? n : null; }
function actor(request: Request) {
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  if (email) return email;
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname) ? "administrator@local" : null;
}

export async function GET(request: Request, context: Context) {
  const id = Number((await context.params).id);
  const url = new URL(request.url);
  const requestedLogsPageSize = url.searchParams.get("logsPageSize");
  const requestedLogsPage = url.searchParams.get("logsPage");
  const logsPageSize = requestedLogsPageSize === null ? (requestedLogsPage === null ? 100000 : activityLogPageSize) : Number(requestedLogsPageSize);
  const logsPage = page(url.searchParams.get("logsPage"));
  const attendancePage = page(url.searchParams.get("attendancePage")), paymentsPage = page(url.searchParams.get("paymentsPage"));
  const requestedPaymentId = url.searchParams.has("paymentId") ? Number(url.searchParams.get("paymentId")) : null;
  if (!Number.isSafeInteger(id) || id < 1 || attendancePage === null || paymentsPage === null || logsPage === null || (requestedLogsPageSize !== null && !activityLogPageSizes.includes(logsPageSize)) || (requestedPaymentId !== null && (!Number.isSafeInteger(requestedPaymentId) || requestedPaymentId < 1))) return json({ error: "Invalid student or page." }, 400);
  try {
    const db = env.DB;
    if (!await db.prepare("SELECT id FROM students WHERE id = ?").bind(id).first()) return json({ error: "Student not found." }, 404);
    const hasHistoricalPaymentPeriods = Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'history_payment_periods'").first());
    const coverageThrough = hasHistoricalPaymentPeriods
      ? "(SELECT coverage_through FROM history_payment_periods hp WHERE CAST(hp.review_payment_id AS INTEGER) = p.id LIMIT 1)"
      : "NULL";
    const results = await db.batch([
      db.prepare("SELECT c.id AS courseId, c.name AS courseName, c.start_date AS startDate, c.end_date AS endDate FROM courses c WHERE c.id IN (SELECT course_id FROM payment_course_allowances a JOIN student_payments p ON p.id = a.payment_id JOIN student_payment_coverage pc ON pc.payment_id = p.id WHERE pc.student_id = ? UNION SELECT course_id FROM attendance WHERE student_id = ? UNION SELECT cl.course_id FROM free_missed_attendance f JOIN classes cl ON cl.id = f.class_id WHERE f.student_id = ?)").bind(id, id, id),
      db.prepare(`SELECT ${attendanceColumns} FROM attendance WHERE student_id = ? ORDER BY attended_at DESC, id DESC LIMIT ? OFFSET ?`).bind(id, activityPageSize, (attendancePage - 1) * activityPageSize),
      db.prepare(`SELECT ${paymentColumns} FROM student_payments WHERE student_id = ? AND (? IS NULL OR id = ?) ORDER BY paid_on DESC, id DESC LIMIT ? OFFSET ?`).bind(id, requestedPaymentId, requestedPaymentId, activityPageSize, (paymentsPage - 1) * activityPageSize),
      db.prepare("SELECT a.payment_id AS paymentId, a.course_id AS courseId, a.course_name AS courseName, a.allowance FROM payment_course_allowances a WHERE a.payment_id IN (SELECT id FROM student_payments WHERE student_id = ? AND (? IS NULL OR id = ?) ORDER BY paid_on DESC, id DESC LIMIT ? OFFSET ?) ORDER BY a.course_id").bind(id, requestedPaymentId, requestedPaymentId, activityPageSize, (paymentsPage - 1) * activityPageSize),
      db.prepare("SELECT COUNT(*) AS paymentCount, COALESCE(SUM(amount_minor), 0) AS totalPaidMinor FROM student_payments WHERE student_id = ?").bind(id),
      db.prepare("SELECT id, name FROM courses ORDER BY name COLLATE NOCASE, id"),
      db.prepare(`SELECT * FROM (
        SELECT id, NULL AS givenToSchool, NULL AS receivedMethod, complimentary, complimentary_by AS complimentaryBy, complimentary_at AS complimentaryAt, course_id AS courseId, 'attendance' AS kind, substr(attended_at, 1, 10) AS eventDate, attended_at AS eventTime, course_name AS courseName, NULL AS amountMinor, notes, recorded_by AS recordedBy, recorded_at AS recordedAt, '[]' AS allocations
        FROM attendance WHERE student_id = ?
        UNION ALL
        SELECT p.id, p.given_to_school AS givenToSchool, p.received_method AS receivedMethod, 0 AS complimentary, NULL AS complimentaryBy, NULL AS complimentaryAt, NULL AS courseId, 'payment', paid_on, paid_on, NULL, amount_minor, notes, recorded_by, recorded_at,
          (SELECT json_group_array(json_object('courseId', a.course_id, 'courseName', a.course_name, 'allowance', a.allowance)) FROM payment_course_allowances a WHERE a.payment_id = p.id)
        FROM student_payments p WHERE p.id IN (SELECT payment_id FROM student_payment_coverage WHERE student_id = ?)
      ) ORDER BY eventDate DESC, CASE kind WHEN 'payment' THEN 1 ELSE 0 END DESC, eventTime DESC, recordedAt DESC, kind DESC, id DESC LIMIT ? OFFSET ?`).bind(id, id, logsPage * logsPageSize, 0),
    ]);
    const eventRows = await db.prepare(`SELECT a.id, 'practice_attendance' AS kind, s.id AS practiceId, s.starts_at AS eventDate,
      'Practice party' AS courseName, a.donation_amount_minor AS amountMinor,
      a.notes || CASE WHEN a.donation_amount_minor IS NULL THEN '' ELSE ' · Donation: ' || a.donation_notes END AS notes,
      a.recorded_by AS recordedBy, a.recorded_at AS recordedAt, NULL AS voidedAt
      FROM practice_attendance a JOIN practice_parties s ON s.id = a.practice_id WHERE a.student_id = ?
      ORDER BY s.starts_at DESC, a.recorded_at DESC, a.id DESC`).bind(id).all<Omit<StudentActivity["logs"][number], "allocations">>();
    const eventLogs: StudentActivity["logs"] = eventRows.results.map(row => ({ ...row, notes: practiceNoteForDisplay(row.notes), complimentary: 1, allocations: [] }));
    const groups = await db.prepare(`SELECT p.id, p.student_count AS studentCount, p.student_id AS payerId,
      s.first_name AS firstName, s.last_name AS lastName, s.picture,
      (SELECT json_group_array(json_object('id', member.id, 'firstName', member.first_name, 'lastName', member.last_name, 'picture', member.picture)) FROM payment_students ps JOIN students member ON member.id = ps.student_id WHERE ps.payment_id = p.id) AS students
      FROM student_payments p JOIN students s ON s.id = p.student_id
      WHERE p.student_count > 1 AND p.id IN (SELECT payment_id FROM student_payment_coverage WHERE student_id = ?)`)
      .bind(id).all<{ id: number; studentCount: number; payerId: number; firstName: string; lastName: string; picture: string | null; students: string }>();
    const groupDetails = new Map(groups.results.map(row => [row.id, { studentCount: row.studentCount, payer: { id: row.payerId, firstName: row.firstName, lastName: row.lastName, picture: row.picture }, students: JSON.parse(row.students) as NonNullable<StudentActivity["payments"][number]["students"]> }]));
    const creditData = await db.batch([
      db.prepare("SELECT course_id AS courseId, day_of_week AS day, start_time AS startTime FROM course_schedule"),
      db.prepare("SELECT course_id AS courseId, class_date AS classDate, start_time AS startTime, cancelled FROM classes"),
      db.prepare(`SELECT p.id AS paymentId, a.course_id AS courseId, p.paid_on AS paidOn, a.allowance, p.notes, ${coverageThrough} AS coverageThrough FROM payment_course_allowances a JOIN student_payments p ON p.id = a.payment_id JOIN student_payment_coverage pc ON pc.payment_id = p.id WHERE pc.student_id = ? ORDER BY p.paid_on, p.id`).bind(id),
      db.prepare("SELECT course_id AS courseId, attended_at AS attendedAt, complimentary FROM attendance WHERE student_id = ?").bind(id),
      db.prepare("SELECT cl.course_id AS courseId, cl.class_date || 'T' || cl.start_time AS startsAt, c.name AS courseName, f.id, f.granted_by AS recordedBy, f.granted_at AS recordedAt, f.notes FROM free_missed_attendance f JOIN classes cl ON cl.id = f.class_id JOIN courses c ON c.id = cl.course_id WHERE f.student_id = ?").bind(id),
    ]);
    type CourseCredit = Parameters<typeof courseCreditBalance>[0];
    const forCourse = <T,>(index: number, courseId: number) => (creditData[index].results as (T & { courseId: number })[]).filter((row) => row.courseId === courseId);
    const coverage = new Map<string, PaymentCoverage>();
    const calculatedLogs: StudentActivity["logs"] = [];
    const now = new Date();
    const creditCourses = (results[0].results as CourseCredit[]).map((course) => ({
      course,
      schedules: forCourse<Parameters<typeof courseCreditBalance>[1][number]>(0, course.courseId),
      occurrences: forCourse<Parameters<typeof courseCreditBalance>[2][number]>(1, course.courseId),
      payments: forCourse<Parameters<typeof courseCreditBalance>[3][number]>(2, course.courseId),
      attendance: forCourse<Parameters<typeof courseCreditBalance>[4][number]>(3, course.courseId),
      freeMissed: forCourse<{ startsAt: string }>(4, course.courseId).map((row) => row.startsAt),
    }));
    const sharedPaymentStarts = resolveSharedPaymentStarts(creditCourses, now);
    const balances = creditCourses.map((item) => courseCreditBalance(item.course,
      item.schedules, item.occurrences,
      item.payments.map((payment) => ({ ...payment, coverageStart: payment.paymentId === undefined ? payment.coverageStart : sharedPaymentStarts.get(payment.paymentId) ?? payment.coverageStart })),
      item.attendance,
      now,
      (paymentId, detail) => coverage.set(`${paymentId}:${item.course.courseId}`, detail),
      (startsAt) => calculatedLogs.push({ id: item.course.courseId, kind: "missed", courseId: item.course.courseId, courseName: item.course.courseName, eventDate: `${startsAt}:00`, amountMinor: null, notes: "", recordedBy: "Automatic", recordedAt: null, allocations: [] }),
      (startsAt) => calculatedLogs.push({ id: item.course.courseId, kind: "cancelled", courseId: item.course.courseId, courseName: item.course.courseName, eventDate: `${startsAt}:00`, amountMinor: null, notes: "", recordedBy: "—", recordedAt: null, allocations: [] }),
      undefined,
      undefined,
      item.freeMissed,
    )).sort((a, b) => a.courseName.localeCompare(b.courseName));
    const summary: StudentActivity["summary"] = balances.reduce((sum, b) => ({ ...sum, missedClasses: sum.missedClasses + b.missedClasses, attendanceCount: sum.attendanceCount + b.attendanceCount, paidAllowance: sum.paidAllowance + b.paidAllowance, remainingAllowance: sum.remainingAllowance + b.remainingAllowance, excessAttendance: sum.excessAttendance + b.excessAttendance }), { missedClasses: 0, attendanceCount: 0, paidAllowance: 0, remainingAllowance: 0, excessAttendance: 0, ...results[4].results[0] as { paymentCount: number; totalPaidMinor: number } });
    summary.missedClasses = calculatedLogs.filter((row) => row.kind === "missed").length;
    const allocations = results[3].results as { paymentId: number; courseId: number; courseName: string; allowance: number }[];
    const payments = (results[2].results as Omit<StudentActivity["payments"][number], "allocations">[]).map((p) => ({ ...p, ...groupDetails.get(p.id), allocations: allocations.filter((a) => a.paymentId === p.id).map(({ courseId, courseName, allowance }) => ({ courseId, courseName, allowance })) }));
    const recordedLogs: StudentActivity["logs"] = (results[6].results as (Omit<StudentActivity["logs"][number], "allocations"> & { allocations: string; eventTime: string })[]).map((row) => ({ ...row, ...(row.kind === "payment" ? groupDetails.get(row.id) : undefined), amountMinor: row.kind === "payment" && groupDetails.get(row.id)?.payer.id !== undefined && groupDetails.get(row.id)!.payer.id !== id ? null : row.amountMinor, eventDate: row.eventTime, allocations: (JSON.parse(row.allocations) as StudentActivity["logs"][number]["allocations"]).map((allocation) => ({ ...allocation, coverage: coverage.get(`${row.id}:${allocation.courseId}`) })) }));
    const freeMissedLogs: StudentActivity["logs"] = (creditData[4].results as { id: number; courseId: number; courseName: string; startsAt: string; recordedBy: string; recordedAt: string; notes: string }[]).map((row) => ({ ...row, kind: "free_missed", eventDate: `${row.startsAt}:00`, amountMinor: null, complimentary: 1, allocations: [] }));
    summary.eventAttendanceCount = eventLogs.filter(r => r.kind === 'practice_attendance' && !r.voidedAt).length;
    summary.donationsMinor = eventLogs.filter(r => r.kind === 'practice_attendance').reduce((sum, r) => sum + (r.amountMinor ?? 0), 0);
    summary.totalPaidMinor += summary.donationsMinor;
    // Merge calculated absences before pagination so no entries are skipped between pages.
    const logs = [...recordedLogs, ...calculatedLogs, ...freeMissedLogs, ...eventLogs].sort((a, b) =>
      b.eventDate.slice(0, 10).localeCompare(a.eventDate.slice(0, 10)) || Number(b.kind === "payment") - Number(a.kind === "payment") ||
      b.eventDate.localeCompare(a.eventDate) || (b.recordedAt ?? "").localeCompare(a.recordedAt ?? "") || b.kind.localeCompare(a.kind) || b.id - a.id,
    ).slice((logsPage - 1) * logsPageSize, logsPage * logsPageSize);
    const paymentMethods = actor(request) ? await db.prepare("SELECT method FROM administrator_payment_methods WHERE email = ? ORDER BY method COLLATE NOCASE").bind(actor(request)).all<{ method: string }>() : { results: [] };
    return json({ canRecordFuturePayments: canRecordFuturePayments(actor(request)), logs, logsPage, logsPageSize, logsCount: summary.attendanceCount + summary.paymentCount + groups.results.filter(row => row.payerId !== id).length + calculatedLogs.length + freeMissedLogs.length + eventLogs.length, summary, balances, payments, attendance: results[1].results as StudentActivity["attendance"], courses: results[5].results as StudentActivity["courses"], paymentMethods: paymentMethods.results.map((item) => item.method), attendancePage, paymentsPage } satisfies StudentActivity);
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
  if (!input || input.kind !== "payment" || typeof input.requestKey !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey) || typeof input.notes !== "string" || input.notes.length > 1000 || typeof input.receivedMethod !== "string") return json({ error: "Enter a valid record with notes of up to 1,000 characters." }, 400);
  let payload: Record<string, unknown>;
  {
    const amountMinor = parseAmount(input.amount, true);
    if (amountMinor === null || !validPaymentDate(input.paidOn, canRecordFuturePayments(email)) || !Array.isArray(input.allocations) || input.allocations.length < 1 || input.allocations.length > 100) return json({ error: canRecordFuturePayments(email) ? "Enter a RON amount of zero or more, a valid payment date, and course allowances." : "Enter a RON amount of zero or more, a payment date up to today, and course allowances." }, 400);
    const allocations: { courseId: number; allowance: number }[] = [];
    for (const item of input.allocations) {
      if (!item || !Number.isSafeInteger(item.courseId) || item.courseId < 1 || !Number.isInteger(item.allowance) || item.allowance < 1 || item.allowance > 10000 || allocations.some((a) => a.courseId === item.courseId)) return json({ error: "Select each course once and enter 1–10,000 classes per course." }, 400);
      allocations.push({ courseId: item.courseId, allowance: item.allowance });
    }
    const receivedMethod = input.receivedMethod.trim();
    if (!receivedMethod || receivedMethod.length > 50 || !await env.DB.prepare("SELECT method FROM administrator_payment_methods WHERE email = ? AND method = ? COLLATE NOCASE").bind(email, receivedMethod).first()) return json({ error: "Choose one of your payment methods in Settings." }, 400);
    payload = { amountMinor, paidOn: input.paidOn, allocations: allocations.sort((a, b) => a.courseId - b.courseId), notes: input.notes.trim(), receivedMethod };
  }
  const studentCount = input.studentCount ?? 1;
  const studentIds = input.studentIds ?? [id];
  if (typeof studentCount !== "number" || !Number.isSafeInteger(studentCount) || studentCount < 1 || studentCount > 10000 || !Array.isArray(studentIds) || studentIds.length !== studentCount || new Set(studentIds).size !== studentCount || !studentIds.includes(id) || studentIds.some((value) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)) return json({ error: "Select exactly the configured number of different students, including the payer (at least 2 for a group)." }, 400);
  // Keep legacy single-payment retry payloads compatible.
  if (studentCount > 1) Object.assign(payload, { studentCount, studentIds: [...studentIds].sort((a, b) => a - b) });
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
        db.prepare("DELETE FROM payment_students WHERE payment_id IN (SELECT id FROM student_payments WHERE id = ? AND student_id = ?)").bind(paymentId, id),
        ...(studentCount > 1 ? [db.prepare("INSERT INTO payment_students (payment_id, student_id) SELECT (SELECT id FROM student_payments WHERE id = ? AND student_id = ?), value FROM json_each(?)").bind(paymentId, id, JSON.stringify(studentIds))] : []),
        db.prepare("UPDATE student_payments SET paid_on = ?, amount_minor = ?, notes = ?, received_method = ?, student_count = ? WHERE id = ? AND student_id = ?").bind(payload.paidOn, payload.amountMinor, payload.notes, payload.receivedMethod, studentCount, paymentId, id),
        db.prepare("DELETE FROM payment_course_allowances WHERE payment_id IN (SELECT id FROM student_payments WHERE id = ? AND student_id = ?)").bind(paymentId, id),
        ...(payload.allocations as { courseId: number; allowance: number }[]).map((a) => db.prepare("INSERT INTO payment_course_allowances (payment_id, course_id, course_name, allowance) VALUES ((SELECT id FROM student_payments WHERE id = ? AND student_id = ?), ?, (SELECT name FROM courses WHERE id = ?), ?)").bind(paymentId, id, a.courseId, a.courseId, a.allowance)),
      ]);
      return json({ id: paymentId });
    }
    const existing = await db.prepare(`SELECT id, student_id, recorded_by, request_payload FROM ${table} WHERE request_key = ?`).bind(input.requestKey).first<{ id: number; student_id: number; recorded_by: string; request_payload: string }>();
    if (existing) return existing.student_id === id && existing.recorded_by === email && existing.request_payload === serialized ? json({ id: existing.id }) : json({ error: "This save was already used for different details. Close the popup and try again." }, 409);
    const statements = [db.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email)];
    {
      statements.push(db.prepare("INSERT INTO student_payments (student_id, paid_on, amount_minor, notes, received_method, recorded_by, recorded_at, request_key, request_payload, student_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, payload.paidOn, payload.amountMinor, payload.notes, payload.receivedMethod, email, new Date().toISOString(), input.requestKey, serialized, studentCount));
      if (studentCount > 1) statements.push(db.prepare("INSERT INTO payment_students (payment_id, student_id) SELECT (SELECT id FROM student_payments WHERE request_key = ?), value FROM json_each(?)").bind(input.requestKey, JSON.stringify(studentIds)));
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
