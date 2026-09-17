import { createOrUpdateEvent, eventAccess, eventHandler, eventJson, freeEvent, positiveId } from '../../../lib/free-events-server';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) { return eventHandler(async () => { await eventAccess(request); return eventJson(await freeEvent(positiveId(Number((await context.params).id)))); }); }
export async function POST(request: Request, context: Context) { const id = positiveId(Number((await context.params).id)); return eventHandler(() => createOrUpdateEvent(request, id)); }
