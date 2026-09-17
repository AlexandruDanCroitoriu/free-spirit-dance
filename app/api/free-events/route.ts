import { createOrUpdateEvent, eventAccess, eventHandler, eventJson, freeEvents } from '../../lib/free-events-server';
export async function GET(request: Request) { return eventHandler(async () => { await eventAccess(request); return eventJson(await freeEvents()); }); }
export async function POST(request: Request) { return eventHandler(() => createOrUpdateEvent(request)); }
