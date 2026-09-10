export type CalendarClass = { courseId: number; classDate: string; startTime: string };
export type ClassStudent = { id: number; firstName: string; lastName: string; picture: string | null; active: number; assigned: number; attended: number; complimentary?: number };
export type ClassRoster = { cancelled: boolean; canManageClass: boolean; canEdit: boolean; courseName: string; endTime: string | null; students: ClassStudent[] };
export function parseClass(value: Record<string, unknown>): CalendarClass | null {
  const courseId = Number(value.courseId);
  if (!Number.isSafeInteger(courseId) || courseId < 1 || typeof value.classDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.classDate) || value.classDate < "1900-01-01" || value.classDate > "9999-12-31" || typeof value.startTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.startTime)) return null;
  const date = new Date(value.classDate + "T12:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.classDate) return null;
  return { courseId, classDate: value.classDate, startTime: value.startTime };
}
export function classWeekday(date: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
}
