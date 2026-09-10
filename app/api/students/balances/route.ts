import { env } from "cloudflare:workers";
import { courseCreditBalance } from "../../../lib/student-activity";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const db = env.DB;
    const data = await db.batch([
      db.prepare("SELECT id, first_name AS firstName, last_name AS lastName, picture FROM students ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE, id"),
      db.prepare("SELECT id AS courseId, name AS courseName, start_date AS startDate, end_date AS endDate FROM courses"),
      db.prepare("SELECT course_id AS courseId, day_of_week AS day, start_time AS startTime FROM course_schedule"),
      db.prepare("SELECT course_id AS courseId, class_date AS classDate, start_time AS startTime, cancelled FROM classes"),
      db.prepare("SELECT p.student_id AS studentId, a.course_id AS courseId, p.paid_on AS paidOn, a.allowance FROM payment_course_allowances a JOIN student_payments p ON p.id = a.payment_id ORDER BY p.paid_on, p.id"),
      db.prepare("SELECT student_id AS studentId, course_id AS courseId, attended_at AS attendedAt FROM attendance"),
      db.prepare("SELECT student_id AS studentId, course_id AS courseId FROM student_courses"),
    ]);
    type Args = Parameters<typeof courseCreditBalance>;
    const courses = new Map((data[1].results as Args[0][]).map((course) => [course.courseId, course]));
    function group<T>(rows: T[], key: (row: T) => string) {
      const groups = new Map<string, T[]>();
      for (const row of rows) { const id = key(row); const list = groups.get(id) ?? []; list.push(row); groups.set(id, list); }
      return groups;
    }
    const schedules = group(data[2].results as (Args[1][number] & { courseId: number })[], (r) => String(r.courseId));
    const classes = group(data[3].results as (Args[2][number] & { courseId: number })[], (r) => String(r.courseId));
    const payments = group(data[4].results as (Args[3][number] & { studentId: number; courseId: number })[], (r) => `${r.studentId}:${r.courseId}`);
    const attendance = group(data[5].results as (Args[4][number] & { studentId: number; courseId: number })[], (r) => `${r.studentId}:${r.courseId}`);
    const balances = new Map<number, ReturnType<typeof courseCreditBalance>[]>();
    const now = new Date();
    const assigned = (data[6].results as { studentId: number; courseId: number }[]).map((row) => `${row.studentId}:${row.courseId}`);
    for (const key of new Set([...assigned, ...payments.keys(), ...attendance.keys()])) {
      const [studentId, courseId] = key.split(":").map(Number);
      const course = courses.get(courseId);
      if (!course) continue;
      const balance = courseCreditBalance(course, schedules.get(String(courseId)) ?? [], classes.get(String(courseId)) ?? [], payments.get(key) ?? [], attendance.get(key) ?? [], now);
      const list = balances.get(studentId) ?? [];
      list.push(balance); balances.set(studentId, list);
    }
    const students = (data[0].results as { id: number; firstName: string; lastName: string; picture: string | null }[])
      .filter((student) => balances.has(student.id))
      .map((student) => ({ ...student, balances: balances.get(student.id)!.map(({ courseId, courseName, remainingAllowance, excessAttendance }) => ({ courseId, courseName, remainingAllowance, excessAttendance })).sort((a, b) => a.courseName.localeCompare(b.courseName)) }));
    return Response.json({ students, courses: [...courses.values()].map(({ courseId, courseName }) => ({ id: courseId, name: courseName })).sort((a, b) => a.name.localeCompare(b.name)) }, { headers });
  } catch (error) {
    console.error("Could not load student balances", error);
    return Response.json({ error: "Could not load student balances." }, { status: 500, headers });
  }
}
