import { env } from "../../../lib/storage";

export async function GET() {
  try {
    const summary = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM students) AS students,
      (SELECT COUNT(*) FROM students WHERE active = 1) AS active,
      (SELECT COUNT(*) FROM students WHERE active = 0) AS inactive,
      (SELECT COUNT(*) FROM attendance) AS classAttendance,
      (SELECT COUNT(*) FROM practice_attendance) AS practiceAttendance
    `).first();
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load student summary", error);
    return Response.json({ error: "Could not load student totals." }, { status: 500 });
  }
}
