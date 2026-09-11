import { env } from "../../lib/storage";
import { parseClass, classWeekday, type CalendarClass, type ClassStudent } from "../../lib/class-attendance";
import { schoolToday } from "../../lib/student-activity";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function actor(request: Request) {
  return request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase() || (["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname) ? "administrator@local" : null);
}
function canEdit(request: Request, slot: CalendarClass) {
  return Boolean(actor(request)) && (actor(request) === "croitoriu.alexandru.code@gmail.com" || slot.classDate === schoolToday());
}
async function scheduledClass(db: D1Database, slot: CalendarClass) {
  const recorded = await db.prepare("SELECT c.name AS courseName, cl.end_time AS endTime FROM classes cl JOIN courses c ON c.id = cl.course_id WHERE cl.course_id = ? AND cl.class_date = ? AND cl.start_time = ?").bind(slot.courseId, slot.classDate, slot.startTime).first<{ courseName: string; endTime: string | null }>();
  if (recorded) return recorded;
  return db.prepare("SELECT c.name AS courseName, s.end_time AS endTime FROM course_schedule s JOIN courses c ON c.id = s.course_id WHERE c.id = ? AND s.day_of_week = ? AND s.start_time = ? AND (c.start_date IS NULL OR c.start_date <= ?) AND (c.end_date IS NULL OR c.end_date >= ?)").bind(slot.courseId, classWeekday(slot.classDate), slot.startTime, slot.classDate, slot.classDate).first<{ courseName: string; endTime: string }>();
}
export async function GET(request: Request) {
  const slot = parseClass(Object.fromEntries(new URL(request.url).searchParams));
  if (!slot) return json({ error: "Invalid calendar class." }, 400);
  try {
    const db = env.DB;
    const scheduled = await scheduledClass(db, slot);
    if (!scheduled) return json({ error: "This class is no longer scheduled. Reload the calendar." }, 404);
    const rows = await db.prepare(`SELECT s.id, s.first_name AS firstName, s.last_name AS lastName, s.picture, s.active,
      EXISTS (SELECT 1 FROM student_courses sc WHERE sc.student_id = s.id AND sc.course_id = ?) AS assigned,
      EXISTS (SELECT 1 FROM attendance a WHERE a.student_id = s.id AND a.course_id = ? AND a.attended_at = ?) AS attended,
      EXISTS (SELECT 1 FROM attendance a WHERE a.student_id = s.id AND a.course_id = ? AND a.attended_at = ? AND a.complimentary = 1) AS complimentary
      FROM students s ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE, s.id`).bind(slot.courseId, slot.courseId, `${slot.classDate}T${slot.startTime}:00`, slot.courseId, `${slot.classDate}T${slot.startTime}:00`).all<ClassStudent>();
    const cancelled = Boolean(await db.prepare("SELECT 1 FROM classes WHERE course_id = ? AND class_date = ? AND start_time = ? AND cancelled = 1").bind(slot.courseId, slot.classDate, slot.startTime).first());
    return json({ ...scheduled, cancelled, canManageClass: Boolean(actor(request)), canEdit: !cancelled && canEdit(request, slot), students: rows.results });
  } catch (error) { console.error("Could not load class roster", error); return json({ error: "Could not load the class students." }, 500); }
}
export async function POST(request: Request) {
  const email = actor(request);
  if (!email) return json({ error: "Sign in to record attendance." }, 401);
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const slot = input && parseClass(input);
  const additions = input?.studentIds ?? [];
  const removals = input?.removeStudentIds ?? [];
  const validIds = (ids: unknown): ids is number[] => Array.isArray(ids) && ids.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  const updates = input?.complimentaryChanges ?? [];
  if (!Array.isArray(updates) || updates.some((change) => !change || typeof change !== "object" || !Number.isSafeInteger(change.studentId) || change.studentId < 1 || typeof change.complimentary !== "boolean")) return json({ error: "Invalid complimentary changes." }, 400);
  const updateIds = updates.map((change: { studentId: number }) => change.studentId);
  if (!slot || !validIds(additions) || !validIds(removals) || additions.length + removals.length + updates.length < 1 || additions.length + removals.length + updates.length > 500 || new Set([...additions, ...removals, ...updateIds]).size !== additions.length + removals.length + updates.length) return json({ error: "Select 1–500 attendance changes for a valid class." }, 400);
  const complimentary = input?.complimentaryStudentIds ?? [];
  const reason = input?.complimentaryReason ?? "";
  if (!validIds(complimentary) || new Set(complimentary).size !== complimentary.length || complimentary.some((id) => !additions.includes(id)) || typeof reason !== "string" || reason.trim().length > 500) return json({ error: "Choose complimentary students from the new attendance and enter a reason of up to 500 characters." }, 400);
  if (!canEdit(request, slot)) return json({ error: "Attendance can only be changed on the class date. Only the main administrator can edit other dates." }, 403);
  try {
    const db = env.DB;
    const scheduled = await scheduledClass(db, slot);
    if (!scheduled) return json({ error: "This class is no longer scheduled. Reload the calendar." }, 409);
    const attendedAt = `${slot.classDate}T${slot.startTime}:00`;
    if (updates.length) {
      const checks = await db.batch(updateIds.map((studentId) => db.prepare("SELECT a.id FROM attendance a JOIN classes c ON c.id = a.class_id WHERE a.student_id = ? AND a.course_id = ? AND a.attended_at = ? AND c.cancelled = 0").bind(studentId, slot.courseId, attendedAt)));
      if (checks.some((result) => !result.results.length)) return json({ error: "An attendance record is no longer available. Reload the class before changing complimentary access." }, 409);
    }
    const now = new Date().toISOString();
    const results = await db.batch([
      db.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email),
      db.prepare("INSERT INTO classes (course_id, class_date, start_time, end_time) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(slot.courseId, slot.classDate, slot.startTime, scheduled.endTime),
      ...additions.map((studentId: number) => db.prepare(`INSERT INTO attendance (class_id, student_id, course_id, course_name, attended_at, recorded_by, recorded_at, notes, request_key, request_payload, complimentary, complimentary_by, complimentary_at)
        SELECT (SELECT id FROM classes WHERE course_id = ? AND class_date = ? AND start_time = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM attendance WHERE student_id = ? AND course_id = ? AND attended_at = ?)
        ON CONFLICT (student_id, course_id, attended_at) WHERE request_key IS NOT NULL DO NOTHING`)
        .bind(slot.courseId, slot.classDate, slot.startTime, studentId, slot.courseId, scheduled.courseName, attendedAt, email, now, complimentary.includes(studentId) ? reason.trim() : "", `calendar-${slot.courseId}-${slot.classDate}-${slot.startTime}-${studentId}`, JSON.stringify({ ...slot, studentId }), complimentary.includes(studentId) ? 1 : 0, complimentary.includes(studentId) ? email : null, complimentary.includes(studentId) ? now : null, studentId, slot.courseId, attendedAt)),
      ...updates.map((change: { studentId: number; complimentary: boolean }) => db.prepare(`UPDATE attendance SET complimentary = ?,
        complimentary_by = ?, complimentary_at = ?
        WHERE student_id = ? AND course_id = ? AND attended_at = ? AND complimentary != ?`)
        .bind(change.complimentary ? 1 : 0, change.complimentary ? email : null, change.complimentary ? now : null, change.studentId, slot.courseId, attendedAt, change.complimentary ? 1 : 0)),
      ...removals.map((studentId) => db.prepare("DELETE FROM attendance WHERE student_id = ? AND course_id = ? AND attended_at = ?").bind(studentId, slot.courseId, attendedAt)),
    ]);
    return json({ recorded: results.slice(2, 2 + additions.length).reduce((sum, result) => sum + result.meta.changes, 0), removed: results.slice(2 + additions.length + updates.length).reduce((sum, result) => sum + result.meta.changes, 0), studentIds: additions, removeStudentIds: removals });
  } catch (error) {
    if (String(error).includes("Class is cancelled")) return json({ error: "This class is cancelled. Reload the class." }, 409);
    if (String(error).includes("FOREIGN KEY")) return json({ error: "A selected student or course no longer exists. No attendance was saved. Reload the class." }, 409);
    console.error("Could not record class attendance", error); return json({ error: "Could not confirm attendance. Retry safely; students already recorded will not be counted twice." }, 500);
  }
}

export async function PATCH(request: Request) {
  const email = actor(request);
  if (!email) return json({ error: "Sign in to manage classes." }, 401);
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const slot = input && parseClass(input);
  if (!slot || typeof input?.cancelled !== "boolean") return json({ error: "Invalid class cancellation." }, 400);
  try {
    const db = env.DB;
    const scheduled = await scheduledClass(db, slot);
    if (!scheduled) return json({ error: "This class is no longer scheduled." }, 409);
    await db.batch([
      db.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email),
      db.prepare("INSERT INTO classes (course_id, class_date, start_time, end_time) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").bind(slot.courseId, slot.classDate, slot.startTime, scheduled.endTime),
      db.prepare("UPDATE classes SET cancelled = ?, cancelled_by = ?, cancelled_at = ? WHERE course_id = ? AND class_date = ? AND start_time = ?").bind(input.cancelled ? 1 : 0, input.cancelled ? email : null, input.cancelled ? new Date().toISOString() : null, slot.courseId, slot.classDate, slot.startTime),
    ]);
    return json({ cancelled: input.cancelled });
  } catch (error) {
    if (String(error).includes("Class already has attendance")) return json({ error: "Remove the recorded attendance before cancelling this class." }, 409);
    console.error("Could not change class cancellation", error);
    return json({ error: "Could not update the class. Please retry." }, 500);
  }
}
