import { env } from "../../lib/storage";
import { validPaymentDate } from "../../lib/student-activity";

type DayRow = { date: string; attendance: number; missed: number; payment: number };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const studentId = Number(url.searchParams.get("studentId"));
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!Number.isInteger(studentId) || studentId < 1 || !validPaymentDate(from, true) || !validPaymentDate(to, true) || from > to || Date.parse(to) - Date.parse(from) > 93 * 86400000) {
    return Response.json({ error: "Choose a student and a calendar range of up to 93 days." }, { status: 400 });
  }
  try {
    if (!await env.DB.prepare("SELECT id FROM students WHERE id = ?").bind(studentId).first()) return Response.json({ error: "Student not found." }, { status: 404 });
    const result = await env.DB.prepare(`
      WITH activity AS (
        SELECT substr(attended_at, 1, 10) AS date, 1 AS attendance, 0 AS missed, 0 AS payment FROM attendance WHERE student_id = ?
        UNION ALL SELECT substr(p.starts_at, 1, 10), 1, 0, 0 FROM practice_attendance pa JOIN practice_parties p ON p.id = pa.practice_id WHERE pa.student_id = ? AND p.cancelled = 0
        UNION ALL SELECT class_date, 0, 1, 0 FROM history_absences WHERE student_id = ?
        UNION ALL SELECT paid_on, 0, 0, 1 FROM student_payments WHERE student_id = ?
      ) SELECT date, SUM(attendance) AS attendance, SUM(missed) AS missed, SUM(payment) AS payment
      FROM activity WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`).bind(studentId, studentId, String(studentId), studentId, from, to).all<DayRow>();
    return Response.json({ events: result.results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load student calendar", error);
    return Response.json({ error: "Could not load student calendar." }, { status: 500 });
  }
}
