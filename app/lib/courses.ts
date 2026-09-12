export const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export type Schedule = { day: string; startTime: string; endTime: string; rentCostMinor: number };
export type CourseInput = { name: string; startDate: string | null; endDate: string | null; schedules: Schedule[] };
export type CoursePaymentPresetInput = { amountMinor: number; allowance: number };
export type CourseCreateInput = CourseInput & { paymentPreset: CoursePaymentPresetInput | null };
export type Course = CourseInput & { id: number; paymentPreset: (CoursePaymentPresetInput & { id: number }) | null; occurrences?: { classDate: string; startTime: string; endTime: string | null; cancelled: number }[]; cancellations?: { classDate: string; startTime: string }[] };
export type CourseRow = { id: number; name: string; startDate: string | null; endDate: string | null; paymentPresetId: number | null; paymentPresetAmountMinor: number | null; paymentPresetAllowance: number | null; day: string | null; startTime: string | null; endTime: string | null; rentCostMinor: number | null };
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
    const { day, startTime, endTime, rentCostMinor } = item as Record<string, unknown>;
    if (typeof day !== "string" || !weekdays.includes(day) || typeof startTime !== "string" || !time.test(startTime) || typeof endTime !== "string" || !time.test(endTime) || endTime <= startTime) return "Each class needs a weekday and valid times, with its end after its start.";
    if (typeof rentCostMinor !== "number" || !Number.isSafeInteger(rentCostMinor) || rentCostMinor < 0 || rentCostMinor > 99_999_999) return "Enter a rent cost from 0 to 999,999.99 RON for each class day.";
    if (schedules.some((s) => s.day === day && s.startTime === startTime)) return "Classes cannot have the same weekday and start time.";
    schedules.push({ day, startTime, endTime, rentCostMinor });
  }
  return { name: input.name.trim(), startDate: input.startDate, endDate, schedules };
}
export function parseCourseCreate(value: unknown): CourseCreateInput | string {
  const course = parseCourse(value);
  if (typeof course === "string") return course;
  const preset = (value as Record<string, unknown>).paymentPreset;
  if (preset === undefined || preset === null) return { ...course, paymentPreset: null };
  if (!preset || typeof preset !== "object") return "Enter a valid payment preset.";
  const { amountMinor, allowance } = preset as Record<string, unknown>;
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 99_999_999) return "Enter a positive payment preset amount from 0.01 to 999,999.99 RON.";
  if (typeof allowance !== "number" || !Number.isSafeInteger(allowance) || allowance < 1 || allowance > 10_000) return "Enter between 1 and 10,000 classes for the payment preset.";
  return { ...course, paymentPreset: { amountMinor, allowance } };
}
export const courseQuery = `SELECT c.id, c.name, c.start_date AS startDate, c.end_date AS endDate, p.id AS paymentPresetId, p.amount_minor AS paymentPresetAmountMinor, a.allowance AS paymentPresetAllowance, s.day_of_week AS day, s.start_time AS startTime, s.end_time AS endTime, s.rent_cost_minor AS rentCostMinor FROM courses c LEFT JOIN payment_presets p ON p.course_id = c.id LEFT JOIN payment_preset_courses a ON a.preset_id = p.id AND a.course_id = c.id LEFT JOIN course_schedule s ON s.course_id = c.id`;
export function serializeCourses(rows: CourseRow[]): Course[] {
  const courses = new Map<number, Course>();
  for (const row of rows) {
    if (!courses.has(row.id)) courses.set(row.id, { id: row.id, name: row.name, startDate: row.startDate, endDate: row.endDate, paymentPreset: row.paymentPresetId === null ? null : { id: row.paymentPresetId, amountMinor: row.paymentPresetAmountMinor!, allowance: row.paymentPresetAllowance! }, schedules: [] });
    if (row.day !== null) courses.get(row.id)!.schedules.push({ day: row.day, startTime: row.startTime!, endTime: row.endTime!, rentCostMinor: row.rentCostMinor! });
  }
  return [...courses.values()];
}
export function scheduleStatements(db: D1Database, input: CourseInput, id?: number) {
  const parent = id === undefined ? "(SELECT seq FROM sqlite_sequence WHERE name = 'courses')" : "?";
  return input.schedules.map((s) => db.prepare(`INSERT INTO course_schedule (course_id, day_of_week, start_time, end_time, rent_cost_minor) VALUES (${parent}, ?, ?, ?, ?)`).bind(...(id === undefined ? [] : [id]), s.day, s.startTime, s.endTime, s.rentCostMinor));
}
