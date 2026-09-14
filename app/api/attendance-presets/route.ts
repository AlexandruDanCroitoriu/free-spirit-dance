import { env } from "../../lib/storage";

type AttendancePreset = { course: string; year: number; studentIds: number[] };

export async function GET() {
  try {
    const result = await env.DB.prepare(`
      SELECT c.name AS course, CAST(substr(a.attended_at, 1, 4) AS INTEGER) AS year, a.student_id AS studentId
      FROM attendance a
      JOIN courses c ON c.id = a.course_id
      WHERE length(a.attended_at) >= 10
      GROUP BY c.id, c.name, year, a.student_id
      ORDER BY c.name COLLATE NOCASE, year, a.student_id
    `).all<{ course: string; year: number; studentId: number }>();
    const presets = new Map<string, AttendancePreset>();
    for (const row of result.results) {
      const key = `${row.course}\u0000${row.year}`;
      const preset = presets.get(key) ?? { course: row.course, year: row.year, studentIds: [] };
      preset.studentIds.push(row.studentId);
      presets.set(key, preset);
    }
    return Response.json({ presets: [...presets.values()] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load attendance presets", error);
    return Response.json({ error: "Could not load attendance presets." }, { status: 500 });
  }
}
