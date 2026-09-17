import { eventHandler, mutateMeeting, positiveId } from '../../../../lib/free-events-server';
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) { const id = positiveId(Number((await context.params).id)); return eventHandler(() => mutateMeeting(request, id)); }
