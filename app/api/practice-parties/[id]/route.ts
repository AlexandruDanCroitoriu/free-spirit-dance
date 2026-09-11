import { eventAccess, eventHandler, eventJson, EventError, mutateEvent, eventDetail, positiveId } from '../../../lib/practice-parties-server';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return eventHandler(async () => {
  const access = await eventAccess(request);
  if (!access.events) throw new EventError('Practice Parties permission is required.', 403);
  return eventJson(await eventDetail(positiveId(Number((await context.params).id)), access));
}); }
export async function POST(request: Request, context: Context) { return eventHandler(async () => mutateEvent(request, positiveId(Number((await context.params).id)))); }
