import { eventAccess, eventHandler, eventJson, mutateEvent, eventDetail, positiveId } from '../../../lib/practice-parties-server';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return eventHandler(async () => {
  await eventAccess(request);
  return eventJson(await eventDetail(positiveId(Number((await context.params).id))));
}); }
export async function POST(request: Request, context: Context) { return eventHandler(async () => mutateEvent(request, positiveId(Number((await context.params).id)))); }
