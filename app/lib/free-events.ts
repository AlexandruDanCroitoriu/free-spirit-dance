import { parseSession, sessionEnd, type PracticeSession } from './practice-parties';
import { validPaymentDate } from './student-activity';

export type FreeEvent = { id: number; name: string; startsOn: string | null; endsOn: string | null; imagePath: string | null; revision: number; meetingCount: number };
export type FreeMeeting = PracticeSession & { eventId: number; name: string; spaceRentMinor: number; acceptsDonations: number; totalDonationsMinor: number };
export const freeButton = 'rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-sans disabled:opacity-50 hover:border-lime-600';
export const freePrimary = `${freeButton} bg-lime-100 text-lime-900`;
export function formatFreeDate(value: string) {
  return new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}
export function dateRange(event: Pick<FreeEvent, 'startsOn' | 'endsOn'>) { return event.startsOn ? `${formatFreeDate(event.startsOn)}${event.endsOn && event.endsOn !== event.startsOn ? ` – ${formatFreeDate(event.endsOn)}` : ''}` : 'Dates not set'; }
export function parseFreeEvent(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Enter event details.');
  const input = value as Record<string, unknown>, name = typeof input.name === 'string' ? input.name.trim() : '';
  const startsOn = input.startsOn === '' || input.startsOn === null ? null : input.startsOn;
  const endsOn = input.endsOn === '' || input.endsOn === null ? null : input.endsOn;
  if (!name || name.length > 160) throw new Error('Enter an event name of up to 160 characters.');
  if (startsOn !== null && (!validPaymentDate(startsOn, true) || (endsOn !== null && (!validPaymentDate(endsOn, true) || endsOn < startsOn)))) throw new Error('Enter a valid event date range.');
  if (startsOn === null && endsOn !== null) throw new Error('Set a start date before an end date.');
  if (input.imagePath !== null && input.imagePath !== undefined && (typeof input.imagePath !== 'string' || input.imagePath.length > 500)) throw new Error('Invalid event image.');
  return { name, startsOn, endsOn, imagePath: typeof input.imagePath === 'string' ? input.imagePath : null };
}
export function parseMeeting(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Enter meeting details.');
  const input = value as Record<string, unknown>, name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 160) throw new Error('Enter a meeting name of up to 160 characters.');
  const session = parseSession(input);
  const rent = input.spaceRent;
  if (typeof rent !== 'string' && typeof rent !== 'number') throw new Error('Enter the space rent cost.');
  const normalized = String(rent).trim().replace(',', '.');
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Enter a space rent cost from 0 to 999,999.99.');
  const spaceRentMinor = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(spaceRentMinor)) throw new Error('Invalid space rent cost.');
  if (typeof input.acceptsDonations !== 'boolean') throw new Error('Choose whether donations are accepted.');
  return { ...session, name, spaceRentMinor, acceptsDonations: input.acceptsDonations ? 1 : 0 };
}
export { sessionEnd };
