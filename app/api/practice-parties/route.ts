import { env } from '../../lib/storage';
import { eventAccess, eventHandler, eventJson, EventError, mutateEvent, sessionColumns } from '../../lib/practice-parties-server';
export async function GET(request: Request) { return eventHandler(async () => {
  const access = await eventAccess(request);
  if (!access.events) throw new EventError('Practice Parties permission is required.', 403);
  const rows = await env.DB.prepare(`SELECT ${sessionColumns} FROM practice_parties s ORDER BY s.starts_at DESC, s.id DESC`).all();
  return eventJson(rows.results);
}); }
export async function POST(request: Request) { return eventHandler(() => mutateEvent(request)); }
