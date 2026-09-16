// Calendar arithmetic at UTC noon avoids browser timezone and DST transitions.
export function formatCalendarDate(value: string): string {
  return new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function addCalendarDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function birthdayInYear(birthDate: string, year: number): string | null {
  if (!validCalendarDate(birthDate) || year < Number(birthDate.slice(0, 4)) || year > 9999) return null;
  const anniversary = `${String(year).padStart(4, '0')}-${birthDate.slice(5)}`;
  return validCalendarDate(anniversary) ? anniversary : `${String(year).padStart(4, '0')}-03-01`;
}
export function nextBirthday(birthDate: string, today: string): string | null {
  if (!validCalendarDate(birthDate) || birthDate > today) return null;
  const year = Number(today.slice(0, 4));
  const date = birthdayInYear(birthDate, year);
  return date && date >= today ? date : birthdayInYear(birthDate, year + 1);
}

export function schoolToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
