import { env } from "../../lib/storage";
import { courseQuery, serializeCourses, type CourseRow } from "../../lib/courses";
export async function GET() {
  try {
    const rows = await env.DB.prepare(courseQuery + " ORDER BY c.name COLLATE NOCASE, c.id, s.id").all<CourseRow>();
    const cancelled = await env.DB.prepare("SELECT course_id AS courseId, class_date AS classDate, start_time AS startTime, end_time AS endTime, cancelled FROM classes").all<{ courseId: number; classDate: string; startTime: string; endTime: string | null; cancelled: number }>();
    return Response.json(serializeCourses(rows.results).map((course) => ({ ...course, occurrences: cancelled.results.filter((item) => item.courseId === course.id), cancellations: cancelled.results.filter((item) => item.courseId === course.id && item.cancelled).map(({ classDate, startTime }) => ({ classDate, startTime })) })), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { console.error("Could not load calendar", error); return Response.json({ error: "Could not load calendar." }, { status: 500 }); }
}
