import { env } from "cloudflare:workers";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
const query = `SELECT c.id, c.name, EXISTS (
  SELECT 1 FROM student_courses sc WHERE sc.course_id = c.id AND sc.student_id = ?
) AS assigned FROM courses c ORDER BY c.name COLLATE NOCASE, c.id`;

export async function GET(_request: Request, context: Context) {
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "Invalid student id." }, { status: 400, headers });
  try {
    const db = env.DB;
    if (!await db.prepare("SELECT id FROM students WHERE id = ?").bind(id).first()) return Response.json({ error: "Student not found." }, { status: 404, headers });
    const result = await db.prepare(query).bind(id).all();
    return Response.json(result.results, { headers });
  } catch (error) {
    console.error("Could not load student courses", error);
    return Response.json({ error: "Could not load courses." }, { status: 500, headers });
  }
}

export async function PUT(request: Request, context: Context) {
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "Invalid student id." }, { status: 400, headers });
  const input = await request.json().catch(() => null) as { courseIds?: unknown } | null;
  if (!Array.isArray(input?.courseIds) || !input.courseIds.every((value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0) || new Set(input.courseIds).size !== input.courseIds.length) {
    return Response.json({ error: "Choose valid courses without duplicates." }, { status: 400, headers });
  }
  try {
    const db = env.DB;
    if (!await db.prepare("SELECT id FROM students WHERE id = ?").bind(id).first()) return Response.json({ error: "Student not found." }, { status: 404, headers });
    const ids = JSON.stringify(input.courseIds);
    // One transaction: invalid/deleted courses roll back the entire change.
    const result = await db.batch([
      db.prepare("DELETE FROM student_courses WHERE student_id = ? AND course_id NOT IN (SELECT value FROM json_each(?))").bind(id, ids),
      db.prepare("INSERT INTO student_courses (student_id, course_id) SELECT ?, value FROM json_each(?) WHERE true ON CONFLICT (student_id, course_id) DO NOTHING").bind(id, ids),
      db.prepare(query).bind(id),
    ]);
    return Response.json(result[2].results, { headers });
  } catch (error) {
    if (String(error).includes("FOREIGN KEY")) return Response.json({ error: "A student or course no longer exists. Reload and try again." }, { status: 409, headers });
    console.error("Could not save student courses", error);
    return Response.json({ error: "Could not save courses. Please try again." }, { status: 500, headers });
  }
}
