export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export type Schedule = { day: string; startTime: string; endTime: string };
export type CourseInput = { name: string; startDate: string | null; endDate: string | null; schedules: Schedule[] };
export type Course = CourseInput & { id: number; occurrences?: { classDate: string; startTime: string; endTime: string | null; cancelled: number }[]; cancellations?: { classDate: string; startTime: string }[] };
export type CourseRow = { id: number; name: string; startDate: string | null; endDate: string | null; day: string | null; startTime: string | null; endTime: string | null };
export function parseCourse(value: unknown): CourseInput | string {
  if (!value || typeof value !== "object") return "A course is required.";
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) return "Enter a course name of up to 120 characters.";
  if (!Array.isArray(input.schedules) || input.schedules.length < 1 || input.schedules.length > 5) return "Choose between one and five weekly classes.";
  const validDate = (date: unknown): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= "1900-01-01" && date <= "9999-12-31" && !Number.isNaN(new Date(date + "T12:00:00Z").getTime()) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date;
  const endDate = input.endDate === "" || input.endDate == null ? null : input.endDate;
  if (!validDate(input.startDate) || (endDate !== null && (!validDate(endDate) || endDate < input.startDate))) return "Enter a valid start date. If provided, the end date must be on or after the start.";
  const schedules: Schedule[] = [];
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  for (const item of input.schedules) {
    if (!item || typeof item !== "object") return "Choose a valid class schedule.";
    const { day, startTime, endTime } = item as Record<string, unknown>;
    if (typeof day !== "string" || !weekdays.includes(day) || typeof startTime !== "string" || !time.test(startTime) || typeof endTime !== "string" || !time.test(endTime) || endTime <= startTime) return "Each class needs a weekday and valid times, with its end after its start.";
    if (schedules.some((s) => s.day === day && s.startTime === startTime)) return "Classes cannot have the same weekday and start time.";
    schedules.push({ day, startTime, endTime });
  }
  return { name: input.name.trim(), startDate: input.startDate, endDate, schedules };
}
export const courseQuery = `SELECT c.id, c.name, c.start_date AS startDate, c.end_date AS endDate, s.day_of_week AS day, s.start_time AS startTime, s.end_time AS endTime FROM courses c LEFT JOIN course_schedule s ON s.course_id = c.id`;
export function serializeCourses(rows: CourseRow[]): Course[] {
  const courses = new Map<number, Course>();
  for (const row of rows) {
    if (!courses.has(row.id)) courses.set(row.id, { id: row.id, name: row.name, startDate: row.startDate, endDate: row.endDate, schedules: [] });
    if (row.day !== null) courses.get(row.id)!.schedules.push({ day: row.day, startTime: row.startTime!, endTime: row.endTime! });
  }
  return [...courses.values()];
}
export function scheduleStatements(db: D1Database, input: CourseInput, id?: number) {
  const parent = id === undefined ? "(SELECT seq FROM sqlite_sequence WHERE name = 'courses')" : "?";
  return input.schedules.map((s) => db.prepare(`INSERT INTO course_schedule (course_id, day_of_week, start_time, end_time) VALUES (${parent}, ?, ?, ?)`).bind(...(id === undefined ? [] : [id]), s.day, s.startTime, s.endTime));
}
