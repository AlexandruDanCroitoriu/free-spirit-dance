import { env } from "cloudflare:workers";
import { courseQuery, scheduleStatements, parseCourse, serializeCourses, type CourseRow } from "../../../lib/courses";

function courseId(value: string) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = courseId((await context.params).id);
  if (id === null) return Response.json({ error: "Invalid course id." }, { status: 400 });
  const parsed = parseCourse(await request.json().catch(() => null));
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });
  try {
    const db = env.DB;
    const existing = await db.prepare("SELECT id FROM courses WHERE id = ?").bind(id).first();
    if (!existing) return Response.json({ error: "Course not found." }, { status: 404 });
    const result = await db.batch([
      db.prepare("UPDATE courses SET name = ?, start_date = ?, end_date = ? WHERE id = ?").bind(parsed.name, parsed.startDate, parsed.endDate, id),
      db.prepare("DELETE FROM course_schedule WHERE course_id = ?").bind(id),
      ...scheduleStatements(db, parsed, id),
      db.prepare(`${courseQuery} WHERE c.id = ? ORDER BY s.id`).bind(id),
    ]);
    return Response.json(serializeCourses(result.at(-1)!.results as CourseRow[])[0]);
  } catch (error) { console.error("Could not update course", error); return Response.json({ error: "Could not update course." }, { status: 500 }); }
}

const relationships = [
  ["classes", "Recorded classes"],
  ["course_schedule", "Weekly scheduled classes"],
  ["student_courses", "Assigned students"],
  ["attendance", "Attendance records"],
  ["payment_course_allowances", "Payment allowances"],
  ["payment_preset_courses", "Payment templates"],
] as const;

async function courseRelationships(db: D1Database, id: number) {
  const results = await db.batch<{ count: number }>(relationships.map(([table]) => db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE course_id = ?`).bind(id)));
  return relationships.map(([table, label], index) => ({ table, label, count: Number(results[index].results[0].count) }));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = courseId((await context.params).id);
  if (id === null) return Response.json({ error: "Invalid course id." }, { status: 400 });
  try {
    const db = env.DB;
    if (!await db.prepare("SELECT id FROM courses WHERE id = ?").bind(id).first()) return Response.json({ error: "Course not found." }, { status: 404 });
    return Response.json({ relationships: await courseRelationships(db, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not load course relationships", error);
    return Response.json({ error: "Could not load course relationships." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = courseId((await context.params).id);
  if (id === null) return Response.json({ error: "Invalid course id." }, { status: 400 });
  try {
    const db = env.DB;
    // Foreign keys also protect against relationships added after the popup loads.
    // Remove the owned schedule and empty classes atomically; any blocker rolls it back.
    const results = await db.batch([
      db.prepare("DELETE FROM course_schedule WHERE course_id = ?").bind(id),
      db.prepare("DELETE FROM classes WHERE course_id = ? AND NOT EXISTS (SELECT 1 FROM attendance WHERE class_id = classes.id)").bind(id),
      db.prepare("DELETE FROM courses WHERE id = ?").bind(id),
    ]);
    const result = results[2];
    if (result.meta.changes === 0) return Response.json({ error: "Course not found." }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (String(error).includes("FOREIGN KEY")) return Response.json({ error: "This course has linked records and cannot be deleted. Review its current relationships." }, { status: 409 });
    console.error("Could not delete course", error); return Response.json({ error: "Could not delete course." }, { status: 500 }); }
}
