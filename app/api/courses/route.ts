import { env } from "cloudflare:workers";
import { courseQuery, parseCourse, scheduleStatements, serializeCourses, type CourseRow } from "../../lib/courses";

export async function GET() {
  try {
    const result = await env.DB.prepare(courseQuery + " ORDER BY c.name COLLATE NOCASE, c.id, s.id").all<CourseRow>();
    return Response.json(serializeCourses(result.results));
  } catch (error) { console.error("Could not load courses", error); return Response.json({ error: "Could not load courses." }, { status: 500 }); }
}
export async function POST(request: Request) {
  const input = parseCourse(await request.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  try {
    const db = env.DB;
    const result = await db.batch([
      db.prepare("INSERT INTO courses (name, start_date, end_date) VALUES (?, ?, ?)").bind(input.name, input.startDate, input.endDate),
      ...scheduleStatements(db, input),
      db.prepare(courseQuery + " WHERE c.id = (SELECT seq FROM sqlite_sequence WHERE name = 'courses') ORDER BY s.id"),
    ]);
    return Response.json(serializeCourses(result.at(-1)!.results as CourseRow[])[0], { status: 201 });
  } catch (error) { console.error("Could not create course", error); return Response.json({ error: "Could not create course." }, { status: 500 }); }
}
