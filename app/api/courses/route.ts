import { env } from "cloudflare:workers";

type Recurrence = "weekly" | "twice_weekly";
export type CourseRow = { id: number; name: string; recurrence_one: Recurrence; day_one: string; start_time_one: string; end_time_one: string; recurrence_two: Recurrence | null; day_two: string | null; start_time_two: string | null; end_time_two: string | null };
type CourseInput = { name: string; recurrenceOne: Recurrence; dayOne: string; startTimeOne: string; endTimeOne: string; recurrenceTwo: Recurrence | null; dayTwo: string | null; startTimeTwo: string | null; endTimeTwo: string | null };
const days = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const columns = "id, name, recurrence_one, day_one, start_time_one, end_time_one, recurrence_two, day_two, start_time_two, end_time_two";

export function serialize(row: CourseRow) {
  return { id: row.id, name: row.name, recurrenceOne: row.recurrence_one, dayOne: row.day_one, startTimeOne: row.start_time_one, endTimeOne: row.end_time_one, recurrenceTwo: row.recurrence_two, dayTwo: row.day_two, startTimeTwo: row.start_time_two, endTimeTwo: row.end_time_two };
}

function validSchedule(recurrence: unknown, day: unknown, startTime: unknown, endTime: unknown) {
  return (recurrence === "weekly" || recurrence === "twice_weekly") && typeof day === "string" && days.has(day) && typeof startTime === "string" && timePattern.test(startTime) && typeof endTime === "string" && timePattern.test(endTime) && endTime > startTime;
}

export function parseCourse(input: unknown): CourseInput | string {
  if (!input || typeof input !== "object") return "A course object is required.";
  const course = input as Record<string, unknown>;
  if (typeof course.name !== "string" || !course.name.trim()) return "Course name is required.";
  if (!validSchedule(course.recurrenceOne, course.dayOne, course.startTimeOne, course.endTimeOne)) return "Choose valid start and end times for the first class. The end time must be later than the start time.";
  const hasSecond = course.recurrenceOne === "twice_weekly";
  if (hasSecond && !validSchedule("twice_weekly", course.dayTwo, course.startTimeTwo, course.endTimeTwo)) return "Choose valid start and end times for the second class. The end time must be later than the start time.";
  const parsed: CourseInput = {
    name: course.name.trim(), recurrenceOne: course.recurrenceOne as Recurrence, dayOne: course.dayOne as string, startTimeOne: course.startTimeOne as string, endTimeOne: course.endTimeOne as string,
    recurrenceTwo: hasSecond ? "twice_weekly" : null, dayTwo: hasSecond ? course.dayTwo as string : null, startTimeTwo: hasSecond ? course.startTimeTwo as string : null, endTimeTwo: hasSecond ? course.endTimeTwo as string : null,
  };
  if (hasSecond && parsed.dayTwo === parsed.dayOne && parsed.startTimeTwo === parsed.startTimeOne && parsed.endTimeTwo === parsed.endTimeOne) return "The second class must use a different day or time.";
  return parsed;
}

export async function GET() {
  try {
    const result = await (env as unknown as CloudflareEnv).DB.prepare(`SELECT ${columns} FROM courses ORDER BY name COLLATE NOCASE`).all<CourseRow>();
    return Response.json(result.results.map(serialize));
  } catch (error) { console.error("Could not load courses", error); return Response.json({ error: "Could not load courses." }, { status: 500 }); }
}

export async function POST(request: Request) {
  const parsed = parseCourse(await request.json().catch(() => null));
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });
  try {
    const result = await (env as unknown as CloudflareEnv).DB.prepare(`INSERT INTO courses (name, recurrence_one, day_one, start_time_one, end_time_one, recurrence_two, day_two, start_time_two, end_time_two) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${columns}`).bind(parsed.name, parsed.recurrenceOne, parsed.dayOne, parsed.startTimeOne, parsed.endTimeOne, parsed.recurrenceTwo, parsed.dayTwo, parsed.startTimeTwo, parsed.endTimeTwo).first<CourseRow>();
    return Response.json(serialize(result as CourseRow), { status: 201 });
  } catch (error) { console.error("Could not create course", error); return Response.json({ error: "Could not create course." }, { status: 500 }); }
}
