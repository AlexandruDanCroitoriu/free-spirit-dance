import { env } from "../../../../lib/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "Invalid student id." }, { status: 400 });
  try {
    if (!await env.DB.prepare("SELECT id FROM students WHERE id = ?").bind(id).first()) return Response.json({ error: "Student not found." }, { status: 404 });
    const result = await env.DB.prepare(`SELECT l.id, l.action, l.field, l.old_value AS oldValue, l.new_value AS newValue,
      l.administrator_email AS administratorEmail, a.name AS administratorName,
      a.picture AS administratorPicture, l.created_at AS createdAt
      FROM student_profile_log l LEFT JOIN admin_profiles a ON a.email = l.administrator_email
      WHERE l.student_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 500`).bind(id).all();
    return Response.json(result.results, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load student profile log", error);
    return Response.json({ error: "Could not load profile history." }, { status: 500 });
  }
}
