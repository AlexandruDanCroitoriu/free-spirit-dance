import { env } from '../../lib/storage';
import { validPaymentDate } from '../../lib/student-activity';
import { eventHandler, eventJson, EventError } from '../../lib/practice-parties-server';
import { eventAccess } from '../../lib/free-events-server';
export async function GET(request: Request) { return eventHandler(async () => {
  await eventAccess(request);
  const url = new URL(request.url), from = url.searchParams.get('from'), to = url.searchParams.get('to');
  const maximumDays = url.searchParams.get('all') === 'true' ? 200 * 366 : 370;
  if (!validPaymentDate(from, true) || !validPaymentDate(to, true) || from > to || Date.parse(to) - Date.parse(from) > maximumDays * 86400000) throw new EventError(`Choose a calendar range of up to ${maximumDays} days.`);
  const meetings = await env.DB.prepare(`SELECT m.id, m.event_id AS eventId, e.name AS eventName, m.name,
    m.starts_at AS startsAt, m.starts_utc AS startsUtc, m.duration_minutes AS durationMinutes,
    m.cancelled, m.revision, m.space_rent_minor AS spaceRentMinor, m.accepts_donations AS acceptsDonations,
    (SELECT COUNT(*) FROM free_event_attendance a WHERE a.meeting_id = m.id) AS attendanceCount
    FROM free_event_meetings m JOIN free_events e ON e.id = m.event_id
    WHERE substr(m.starts_at, 1, 10) BETWEEN ? AND ? ORDER BY m.starts_at, m.id`).bind(from, to).all();
  return eventJson({ meetings: meetings.results, canOpen: true });
}); }
