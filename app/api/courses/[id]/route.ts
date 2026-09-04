import { env } from "cloudflare:workers";
import { columns, parseCourse, serialize, type CourseRow } from "../route";

function courseId(value: string) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = courseId((await context.params).id);
  if (id === null) return Response.json({ error: "Invalid course id." }, { status: 400 });
  const parsed = parseCourse(await request.json().catch(() => null));
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });
  try {
    const result = await (env as unknown as CloudflareEnv).DB.prepare(`UPDATE courses SET name = ?, recurrence_one = ?, day_one = ?, start_time_one = ?, end_time_one = ?, recurrence_two = ?, day_two = ?, start_time_two = ?, end_time_two = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING ${columns}`).bind(parsed.name, parsed.recurrenceOne, parsed.dayOne, parsed.startTimeOne, parsed.endTimeOne, parsed.recurrenceTwo, parsed.dayTwo, parsed.startTimeTwo, parsed.endTimeTwo, id).first<CourseRow>();
    if (!result) return Response.json({ error: "Course not found." }, { status: 404 });
    return Response.json(serialize(result));
  } catch (error) { console.error("Could not update course", error); return Response.json({ error: "Could not update course." }, { status: 500 }); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = courseId((await context.params).id);
  if (id === null) return Response.json({ error: "Invalid course id." }, { status: 400 });
  try {
    const result = await (env as unknown as CloudflareEnv).DB.prepare("DELETE FROM courses WHERE id = ?").bind(id).run();
    if (result.meta.changes === 0) return Response.json({ error: "Course not found." }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) { console.error("Could not delete course", error); return Response.json({ error: "Could not delete course." }, { status: 500 }); }
}
