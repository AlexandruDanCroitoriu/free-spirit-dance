import { env } from "../../lib/storage";
import { courseQuery, parseCourseCreate, scheduleStatements, serializeCourses, type CourseRow } from "../../lib/courses";

export async function GET() {
  try {
    const result = await env.DB.prepare(courseQuery + " ORDER BY c.name COLLATE NOCASE, c.id, s.id").all<CourseRow>();
    return Response.json(serializeCourses(result.results));
  } catch (error) { console.error("Could not load courses", error); return Response.json({ error: "Could not load courses." }, { status: 500 }); }
}
export async function POST(request: Request) {
  const input = parseCourseCreate(await request.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  try {
    const db = env.DB;
    const result = await db.batch([
      db.prepare("INSERT INTO courses (name, start_date, end_date) VALUES (?, ?, ?)").bind(input.name, input.startDate, input.endDate),
      ...scheduleStatements(db, input),
      ...(input.paymentPreset ? [
        db.prepare("INSERT INTO payment_presets (name, amount_minor, course_id) VALUES (?, ?, (SELECT seq FROM sqlite_sequence WHERE name = 'courses'))").bind(input.name, input.paymentPreset.amountMinor),
        db.prepare("INSERT INTO payment_preset_courses (preset_id, course_id, allowance) VALUES ((SELECT seq FROM sqlite_sequence WHERE name = 'payment_presets'), (SELECT seq FROM sqlite_sequence WHERE name = 'courses'), ?)").bind(input.paymentPreset.allowance),
      ] : []),
      db.prepare(courseQuery + " WHERE c.id = (SELECT seq FROM sqlite_sequence WHERE name = 'courses') ORDER BY s.id"),
    ]);
    return Response.json(serializeCourses(result.at(-1)!.results as CourseRow[])[0], { status: 201 });
  } catch (error) {
    if (String(error).includes("UNIQUE")) return Response.json({ error: "A payment preset already uses this course name. Choose a different course name or create the preset separately." }, { status: 409 });
    console.error("Could not create course", error); return Response.json({ error: "Could not create course." }, { status: 500 });
  }
}
