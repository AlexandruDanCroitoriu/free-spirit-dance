'use client';

import { useEffect, useState } from 'react';
import { requestJson } from '../lib/http';
import { formatCalendarDate, validCalendarDate } from '../lib/calendar-dates';
import { formatFreeDate } from '../lib/free-events';
import { formatMoney } from '../lib/student-activity';

type Entry = {
  id: number;
  action: string;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
  administrator: string;
  administratorPicture: string | null;
};
const fields = { name: 'Event name', startsOn: 'From', endsOn: 'To', imagePath: 'Event image' };
const meetingFields = { name: 'Meeting name', startsAt: 'Date / time', durationMinutes: 'Duration (minutes)', spaceRentMinor: 'Space rent', acceptsDonations: 'Accepts donations', cancelled: 'Cancelled', attendance: 'Attendance / donations' };
function snapshot(json: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
function value(field: string, data: unknown) {
  if (data === undefined) return 'Not recorded';
  if (data === null || data === '') return 'Not set';
  if (field === 'imagePath') return 'Image set';
  if (field === 'acceptsDonations' || field === 'cancelled') return data ? 'Yes' : 'No';
  if (field === 'spaceRentMinor' && typeof data === 'number') return formatMoney(data);
  if (field === 'startsAt' && typeof data === 'string') return `${formatFreeDate(data)} · ${data.slice(11, 16)}`;
  if (typeof data === 'number') return String(data);
  if (typeof data !== 'string') return 'Not recorded';
  return (field === 'startsOn' || field === 'endsOn') && validCalendarDate(data) ? formatCalendarDate(data) : data;
}
function changes(entry: Entry, isMeeting: boolean) {
  const before = snapshot(entry.beforeJson), after = snapshot(entry.afterJson);
  return Object.entries(isMeeting ? meetingFields : fields).flatMap(([field, label]) => {
    if (!(field in after) || (entry.action !== 'created' && before[field] === after[field])) return [];
    if (entry.action === 'created') return [`${label}: ${value(field, after[field])}`];
    if (field === 'imagePath' && before[field] && after[field]) return ['Event image: Replaced'];
    return [`${label}: ${value(field, before[field])} → ${value(field, after[field])}`];
  });
}

export default function FreeEventHistory({ eventId, meetingId, revision }: { eventId: number; meetingId?: number; revision: number }) {
  const subject = meetingId ? 'Meeting' : 'Event';
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setEntries(null);
    requestJson<Entry[]>(`/api/free-events/${eventId}${meetingId ? `/meetings/${meetingId}` : ''}/history`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setEntries(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load event history.'); });
    return () => controller.abort();
  }, [eventId, meetingId, revision, refresh]);

  return <section aria-label={`${subject} history`} className="space-y-4 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <h2 className="m-0 text-xl">{subject} history</h2>
      <button type="button" className="rounded-lg border border-stone-300 bg-white px-3 py-2 font-sans text-sm hover:border-lime-600" onClick={() => setRefresh(x => x + 1)}>Refresh</button>
    </div>
    {error ? <p role="alert" className="font-sans text-sm text-red-700">{error}</p>
      : !entries ? <p role="status" className="font-sans text-sm text-slate-500">Loading history…</p>
      : !entries.length ? <p className="font-sans text-sm text-slate-500">No history recorded yet.</p>
      : <ol className="m-0 list-none divide-y divide-stone-200 p-0">
        {entries.map(entry => {
          const details = changes(entry, Boolean(meetingId));
          const name = entry.administrator?.trim() || 'Unknown administrator';
          const initials = name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
          return <li key={entry.id} className="space-y-2 py-4 font-sans text-sm">
            <p className="m-0 font-semibold">{entry.action === 'attendance_updated' ? 'Updated attendance / donations' : `${entry.action === 'created' ? 'Created' : 'Updated'} ${subject.toLowerCase()}`}</p>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 font-semibold text-slate-800">
                {entry.administratorPicture && /^\/(?!\/)/.test(entry.administratorPicture)
                  ? <img src={entry.administratorPicture} alt="" loading="lazy" className="h-full w-full object-cover" />
                  : initials}
              </span>
              <div className="min-w-0">
                <p className="m-0 break-words font-semibold text-slate-800">{name}</p>
                <p className="m-0"><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' })}</time> · Bucharest time</p>
              </div>
            </div>
            {details.length ? <ul className="list-disc space-y-1 pl-5">{details.map(detail => <li key={detail} className="whitespace-pre-wrap break-words">{detail}</li>)}</ul> : <p className="m-0 text-slate-500">No field changes recorded.</p>}
          </li>;
        })}
      </ol>}
  </section>;
}
