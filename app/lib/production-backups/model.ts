export const TIMEZONE = "Europe/Bucharest";
export type Schedule = { enabled: boolean; weekday: number; time: string; next: string; once: string | null };
export type Backup = { id: string; name: string; createdAt: string; expiresAt: string; status: "creating" | "ready" | "failed" | "deleting"; bytes: number; photos: number; schema: string; category?: "manual" | "automatic"; sourceBackupId?: string; databaseId?: string; workingReady?: boolean; error?: string; snapshotDeleted?: boolean };
export type Job = { id: string; kind: "backup" | "activate" | "return" | "delete"; backupId: string; actor: string; startedAt: string; sourceBackupId?: string; safetyBackupId?: string; readOnly?: boolean };
export type Control = { active: string; generation: number; maintenance: string | null; job: Job | null; schedule: Schedule; readOnly?: boolean; previewPrevious?: string };
export function romanianParts(date: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function localToUtc(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("Choose a valid date and time.");
  const nominal = Date.parse(`${local}Z`);
  // Romania uses UTC+2 / UTC+3. Reject nonexistent spring-forward times;
  // choose the first occurrence of an ambiguous autumn time.
  for (const offset of [3, 2]) {
    const candidate = new Date(nominal - offset * 3600000);
    if (Number.isFinite(candidate.getTime()) && romanianParts(candidate) === local) return candidate.toISOString();
  }
  throw new Error("This time does not exist in Romania because the clocks change. Choose another time.");
}
export function nextWeekly(after: number, weekday = 6, time = "04:00"): string {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Choose a valid weekly schedule.");
  const localDay = romanianParts(new Date(after)).slice(0, 10);
  for (let day = 0; day < 15; day++) {
    const date = new Date(Date.parse(`${localDay}T12:00:00Z`) + day * 86400000);
    if (date.getUTCDay() !== weekday) continue;
    try {
      const utc = localToUtc(`${date.toISOString().slice(0, 10)}T${time}`);
      if (Date.parse(utc) > after) return utc;
    } catch { /* Skip a nonexistent daylight-saving time. */ }
  }
  throw new Error("Could not calculate the next backup.");
}
export function sixMonthsAfter(iso: string): string {
  const date = new Date(iso), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 6);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString();
}
export function initialControl(now = Date.now()): Control {
  return { active: "production", generation: 1, maintenance: null, job: null, schedule: { enabled: true, weekday: 6, time: "04:00", next: nextWeekly(now), once: null } };
}
