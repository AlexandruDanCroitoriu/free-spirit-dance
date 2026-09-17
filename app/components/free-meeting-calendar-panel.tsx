'use client';

import { useEffect, useState } from 'react';
import MeetingPanel from './free-meeting-panel';
import { requestJson } from '../lib/http';
import type { FreeEvent, FreeMeeting } from '../lib/free-events';

export default function FreeMeetingCalendarPanel({ eventId, meetingId, onClose }: { eventId: number; meetingId: number; onClose: () => void }) {
  const [data, setData] = useState<{ event: FreeEvent; meetings: FreeMeeting[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ event: FreeEvent; meetings: FreeMeeting[] }>(`/api/free-events/${eventId}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) {
        if (!value.meetings.some(meeting => meeting.id === meetingId)) throw new Error('Meeting no longer exists.');
        setData(value);
      } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [eventId, meetingId]);
  if (!data) return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-5"><div className="rounded-xl bg-white p-5 font-sans text-sm"><p role={error ? 'alert' : 'status'}>{error || 'Loading meeting…'}</p><button className="rounded-lg border border-stone-300 px-3 py-2" onClick={onClose}>Close</button></div></div>;
  return <MeetingPanel key={meetingId} initialTab="attendance" event={data.event} meeting={data.meetings.find(meeting => meeting.id === meetingId)} close={onClose}
    refresh={() => window.dispatchEvent(new Event('calendar-updated'))} />;
}
