import { env } from '../../lib/storage';
import { validPaymentDate } from '../../lib/student-activity';
import { eventAccess, eventHandler, eventJson, EventError, sessionColumns } from '../../lib/practice-parties-server';
export async function GET(request: Request) { return eventHandler(async () => {
  const access = await eventAccess(request);
  if (!access.dashboard) throw new EventError('Dashboard permission is required.', 403);
  const url = new URL(request.url), from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!validPaymentDate(from, true) || !validPaymentDate(to, true) || from > to || Date.parse(to) - Date.parse(from) > 93 * 86400000) throw new EventError('Choose a calendar range of up to 93 days.');
  const result = await env.DB.prepare(`SELECT ${sessionColumns} FROM practice_parties s WHERE substr(s.starts_at, 1, 10) BETWEEN ? AND ? ORDER BY s.starts_at, s.id`).bind(from, to).all();
  return eventJson({ sessions: result.results, canOpen: access.roster });
}); }
