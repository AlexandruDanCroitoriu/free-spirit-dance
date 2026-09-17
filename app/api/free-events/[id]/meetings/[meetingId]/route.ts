import { eventHandler, mutateMeeting, positiveId } from '../../../../../lib/free-events-server';
type Context = { params: Promise<{ id: string; meetingId: string }> };
export async function POST(request: Request, context: Context) { const p = await context.params; return eventHandler(() => mutateMeeting(request, positiveId(Number(p.id)), positiveId(Number(p.meetingId)))); }
