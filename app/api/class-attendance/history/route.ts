import { env } from "../../../lib/storage";
import { parseClass } from "../../../lib/class-attendance";

export async function GET(request: Request) {
  const slot = parseClass(Object.fromEntries(new URL(request.url).searchParams));
  if (!slot) return Response.json({ error: "Invalid calendar class." }, { status: 400 });
  try {
    const result = await env.DB.prepare(`SELECT l.id, l.action, l.field, l.old_value AS oldValue, l.new_value AS newValue,
      l.student_name AS studentName, l.administrator_email AS administratorEmail,
      a.name AS administratorName, a.picture AS administratorPicture, l.created_at AS createdAt
      FROM class_change_log l JOIN classes cl ON cl.id = l.class_id
      LEFT JOIN admin_profiles a ON a.email = l.administrator_email
      WHERE cl.course_id = ? AND cl.class_date = ? AND cl.start_time = ?
      ORDER BY l.created_at DESC, l.id DESC LIMIT 500`).bind(slot.courseId, slot.classDate, slot.startTime).all();
    return Response.json(result.results, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load class history", error);
    return Response.json({ error: "Could not load class history." }, { status: 500 });
  }
}
