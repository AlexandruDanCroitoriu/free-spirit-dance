import { eventHandler, positiveId } from '../../../../../../lib/free-events-server';
import { meetingRoster, saveMeetingAttendance } from '../../../../../../lib/free-meeting-attendance-server';
type Context = { params: Promise<{ id: string; meetingId: string }> };
export async function GET(request: Request, context: Context) {
  return eventHandler(async () => { const p = await context.params; return meetingRoster(request, positiveId(Number(p.id)), positiveId(Number(p.meetingId))); });
}
export async function POST(request: Request, context: Context) {
  return eventHandler(async () => { const p = await context.params; return saveMeetingAttendance(request, positiveId(Number(p.id)), positiveId(Number(p.meetingId))); });
}
