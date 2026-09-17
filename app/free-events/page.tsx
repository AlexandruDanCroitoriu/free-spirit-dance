'use client';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { requestJson } from '../lib/http';
import { dateRange, formatFreeDate, freeButton, freePrimary, type FreeEvent, type FreeMeeting } from '../lib/free-events';
import MeetingPanel from '../components/free-meeting-panel';
import DatePicker from '../components/date-picker';
import FreeEventHistory from '../components/free-event-history';
import FreeEventImageInput from '../components/free-event-image-input';
import { eventInput } from '../lib/practice-parties';
import { confirmAction } from '../lib/confirmation';
import { formatMoney } from '../lib/student-activity';
type Detail={event:FreeEvent;meetings:FreeMeeting[]}; type EventDraft={name:string;startsOn:string;endsOn:string;imagePath:string|null};
type Direction = 'ascending' | 'descending';
type EventSort = 'image' | 'name' | 'dateRange' | 'meetings';
type MeetingSort = 'name' | 'date' | 'startTime' | 'duration' | 'attendance' | 'donations';
type Sort<T extends string> = { field: T; direction: Direction } | null;
const blank=():EventDraft=>({name:'',startsOn:'',endsOn:'',imagePath:null});
const compareText = (left: string, right: string) => left.localeCompare(right, 'ro', { sensitivity: 'base' });
function toggleSort<T extends string>(current: Sort<T>, field: T): Sort<T> { return current?.field === field ? { field, direction: current.direction === 'ascending' ? 'descending' : 'ascending' } : { field, direction: 'ascending' }; }
function SortHeader<T extends string>({ field, label, sort, setSort, className = '' }: { field: T; label: ReactNode; sort: Sort<T>; setSort: (sort: Sort<T>) => void; className?: string }) {
  const active = sort?.field === field, direction = active ? sort.direction : 'none';
  return <th scope="col" aria-sort={direction} className={className}><button type="button" className="inline-flex items-center gap-1 rounded text-left hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600" onClick={() => setSort(toggleSort(sort, field))}>{label}<span aria-hidden="true" className={active ? 'text-slate-800' : 'text-slate-400'}>{active ? (sort.direction === 'ascending' ? '↑' : '↓') : '↕'}</span><span className="sr-only">{active ? `, sorted ${sort.direction}` : ', not sorted'}</span></button></th>;
}
function sortedEvents(events: FreeEvent[], sort: Sort<EventSort>) { if (!sort) return events; const factor = sort.direction === 'ascending' ? 1 : -1; return [...events].sort((left, right) => { if (sort.field === 'dateRange' && (!left.startsOn || !right.startsOn)) return !left.startsOn && !right.startsOn ? (left.id - right.id) * factor : !left.startsOn ? 1 : -1; let result = 0; if (sort.field === 'image') result = Number(Boolean(left.imagePath)) - Number(Boolean(right.imagePath)); else if (sort.field === 'name') result = compareText(left.name, right.name); else if (sort.field === 'meetings') result = left.meetingCount - right.meetingCount; else result = left.startsOn!.localeCompare(right.startsOn!) || (left.endsOn ?? '').localeCompare(right.endsOn ?? ''); return (result || left.id - right.id) * factor; }); }
function sortedMeetings(meetings: FreeMeeting[], sort: Sort<MeetingSort>) { if (!sort) return meetings; const factor = sort.direction === 'ascending' ? 1 : -1; return [...meetings].sort((left, right) => { const result = sort.field === 'name' ? compareText(left.name, right.name) : sort.field === 'date' ? left.startsAt.slice(0, 10).localeCompare(right.startsAt.slice(0, 10)) : sort.field === 'startTime' ? left.startsAt.slice(11, 16).localeCompare(right.startsAt.slice(11, 16)) : sort.field === 'duration' ? left.durationMinutes - right.durationMinutes : sort.field === 'attendance' ? left.attendanceCount - right.attendanceCount : left.totalDonationsMinor - right.totalDonationsMinor; return (result || left.id - right.id) * factor; }); }
async function send(url:string,body:object){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),x=await r.json() as {error?:string};if(!r.ok)throw new Error(x.error??'Could not save.');window.dispatchEvent(new Event('calendar-updated'));window.dispatchEvent(new Event('payment-transfer-updated'));}
function Panel({title,close,children}:{title:string;close:()=>void;children:ReactNode}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);return <dialog ref={ref} className="fixed inset-0 m-0 box-border h-dvh max-h-none w-auto max-w-none overflow-y-auto border-0 bg-stone-50 p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60 md:inset-y-0 md:left-auto md:w-full md:max-w-3xl" onCancel={e=>{e.preventDefault();close();}}><header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white p-5"><h2 className="m-0 text-2xl">{title}</h2><button className={freeButton} onClick={close}>Close</button></header><div className="space-y-4 p-5">{children}</div></dialog>}
export default function FreeEvents() {
  const [events, setEvents] = useState<FreeEvent[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [event, setEvent] = useState<number | 'new' | null>(null);
  const [meeting, setMeeting] = useState<{ event: FreeEvent; meeting?: FreeMeeting } | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [eventSort, setEventSort] = useState<Sort<EventSort>>(null);
  const [meetingSort, setMeetingSort] = useState<Sort<MeetingSort>>(null);
  const refresh = () => setReload(value => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    requestJson<FreeEvent[]>('/api/free-events', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setEvents(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const open = () => setEvent('new');
    window.addEventListener('open-add-free-event', open);
    return () => window.removeEventListener('open-add-free-event', open);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setDetailError('');
    if (expanded) requestJson<Detail>(`/api/free-events/${expanded}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setDetail(data); })
      .catch(reason => { if (!controller.signal.aborted) setDetailError(reason.message); });
    return () => controller.abort();
  }, [expanded, reload]);
  return <main className="mx-auto w-full max-w-6xl p-4 md:p-10">
    {error && <p role="alert" className="font-sans text-sm text-red-700">{error}</p>}
    <section aria-label="Free events" className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left font-sans text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><SortHeader field="image" label="Image" sort={eventSort} setSort={setEventSort} className="w-28 px-5 py-4" /><SortHeader field="name" label="Name" sort={eventSort} setSort={setEventSort} className="px-4 py-4" /><SortHeader field="dateRange" label="Date range" sort={eventSort} setSort={setEventSort} className="px-4 py-4" /><SortHeader field="meetings" label="Meetings" sort={eventSort} setSort={setEventSort} className="px-4 py-4 text-center" /><th scope="col" className="w-24 px-4 py-4"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>{sortedEvents(events, eventSort).map(item => {
            const open = expanded === item.id;
            const current = detail?.event.id === item.id ? detail : null;
            return <Fragment key={item.id}>
              <tr className={`cursor-pointer border-b border-stone-200 transition-colors ${open ? 'bg-lime-50/50' : 'hover:bg-stone-50'}`} onClick={() => setExpanded(open ? null : item.id)}>
                <td className="px-5 py-4">{item.imagePath
                  ? <img src={item.imagePath} alt="" className="h-14 w-20 rounded-lg border border-stone-200 object-cover" />
                  : <span className="flex h-14 w-20 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-xs text-slate-400">No image</span>}</td>
                <td className="px-4 py-4">
                  <button type="button" aria-expanded={open} aria-controls={`event-meetings-${item.id}`} className="flex items-center gap-2 rounded text-left font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600" onClick={e => { e.stopPropagation(); setExpanded(open ? null : item.id); }}>
                    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}><path d="m7 4 6 6-6 6" /></svg>
                    {item.name}
                  </button>
                </td>
                <td className={`px-4 py-4 ${item.startsOn ? 'text-slate-700' : 'text-slate-400'}`}>{dateRange(item)}</td>
                <td className="px-4 py-4 text-center"><span className="inline-flex min-w-8 items-center justify-center rounded-full bg-lime-100 px-2.5 py-1 text-xs font-semibold text-lime-900">{item.meetingCount}</span></td>
                <td className="px-4 py-4 text-right"><div className="flex items-center justify-end gap-2 whitespace-nowrap"><button className={freePrimary} onClick={e => { e.stopPropagation(); setMeeting({ event: item }); }}>Add meeting</button><button className={freeButton} aria-label={`Edit event ${item.name}`} onClick={e => { e.stopPropagation(); setEvent(item.id); }}>Edit</button></div></td>
              </tr>
              <tr id={`event-meetings-${item.id}`} hidden={!open}><td colSpan={5} className="border-b border-stone-200 bg-stone-50/80 p-5">
                {open && <div className="space-y-4 border-l-2 border-lime-400 pl-4">
                  {detailError ? <p role="alert" className="text-red-700">{detailError}</p>
                    : !current ? <p role="status" className="text-slate-500">Loading meetings…</p>
                    : !current.meetings.length ? <p className="rounded-lg border border-dashed border-stone-300 bg-white p-5 text-center text-slate-500">No meetings scheduled. Add a meeting to get started.</p>
                    : <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
                      <table className="w-full border-collapse text-left text-sm">
                        <thead className="border-b border-stone-200 bg-stone-50 text-xs text-slate-500"><tr><SortHeader field="name" label="Meeting" sort={meetingSort} setSort={setMeetingSort} className="px-4 py-3 font-medium" /><SortHeader field="date" label="Date" sort={meetingSort} setSort={setMeetingSort} className="px-4 py-3 font-medium" /><SortHeader field="startTime" label="Start time" sort={meetingSort} setSort={setMeetingSort} className="px-4 py-3 font-medium" /><SortHeader field="duration" label="Duration" sort={meetingSort} setSort={setMeetingSort} className="px-4 py-3 font-medium" /><SortHeader field="attendance" label="Attendances" sort={meetingSort} setSort={setMeetingSort} className="px-4 py-3 font-medium" /><SortHeader field="donations" label="Donations" sort={meetingSort} setSort={setMeetingSort} className="px-4 py-3 font-medium" /><th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
                        <tbody className="divide-y divide-stone-100">{sortedMeetings(current.meetings, meetingSort).map(m => <tr key={m.id} className="hover:bg-stone-50/70">
                          <td className="px-4 py-3 font-semibold text-slate-800">{m.name}</td>
                          <td className="px-4 py-3 text-slate-700">{formatFreeDate(m.startsAt)}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{m.startsAt.slice(11, 16)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-500">{m.durationMinutes} min</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{m.attendanceCount}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-700">{formatMoney(m.totalDonationsMinor)}</td>
                          <td className="px-4 py-3 text-right"><button className={freeButton} aria-label={`Edit meeting ${m.name}`} onClick={() => setMeeting({ event: item, meeting: m })}>Edit</button></td>
                        </tr>)}</tbody>
                      </table>
                    </div>}
                </div>}
              </td></tr>
            </Fragment>;
          })}</tbody>
        </table>
      </div>
      {loading ? <p role="status" className="p-8 text-center font-sans text-sm text-slate-500">Loading events…</p> : !events.length && !error && <p className="p-8 text-center font-sans text-sm text-slate-500">No free events yet.</p>}
    </section>
    {event !== null && <EventPanel id={event === 'new' ? undefined : event} close={() => setEvent(null)} refresh={refresh} />}
    {meeting && <MeetingPanel {...meeting} close={() => setMeeting(null)} refresh={refresh} />}
  </main>;
}
function EventPanel({ id, close, refresh }: { id?: number; close: () => void; refresh: () => void }) {
  const [d, setD] = useState<EventDraft>(blank());
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'details' | 'history'>('details');
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const saved = useRef('');
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    requestJson<Detail>(`/api/free-events/${id}`, { signal: controller.signal }).then(x => {
      if (controller.signal.aborted) return;
      const draft = { name: x.event.name, startsOn: x.event.startsOn ?? '', endsOn: x.event.endsOn ?? '', imagePath: x.event.imagePath };
      saved.current = JSON.stringify(draft);
      setD(draft);
      setRevision(x.event.revision);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id]);
  useEffect(() => {
    if (!id || revision === null || uploadingImage || !d.name.trim() || JSON.stringify(d) === saved.current) return;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError('');
      try {
        await send(`/api/free-events/${id}`, { action: 'update', revision, event: d });
        saved.current = JSON.stringify(d);
        setRevision(revision + 1);
        refreshRef.current();
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not save event.'); }
      finally { setBusy(false); }
    }, 500);
    return () => clearTimeout(timer);
  }, [d, id, revision, uploadingImage]);
  async function remove() {
    if (!id || revision === null || busy) return;
    if (!await confirmAction('Delete event?', 'This permanently removes this event and all of its meetings.', 'Delete event', true)) return;
    setBusy(true);
    try {
      await send(`/api/free-events/${id}`, { action: 'delete', revision });
      refresh();
      close();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete event.'); }
    finally { setBusy(false); }
  }
  return (
    <Panel title={id ? 'Edit event' : 'Add free event'} close={close}>
      {id && <nav aria-label="Event sections" className="flex gap-5 border-b border-stone-200">
        {(['details', 'history'] as const).map(section => <button key={section} type="button" aria-pressed={tab === section} className={`border-b-2 px-1 py-3 font-sans text-sm font-semibold ${tab === section ? 'border-lime-600 text-slate-800' : 'border-transparent text-slate-500'}`} onClick={() => setTab(section)}>{section === 'details' ? 'Event details' : 'History'}</button>)}
      </nav>}
      {tab === 'history' && id ? <FreeEventHistory eventId={id} revision={revision ?? 0} /> : <section aria-label="Event details" className="space-y-4 rounded-xl border-2 border-lime-500 bg-white p-5 shadow-sm">
        <h2 className="text-xl">Event details</h2>
        {id && <p className="font-sans text-sm text-slate-500">Changes save automatically.</p>}
        <fieldset disabled={busy || uploadingImage || (!!id && revision === null)} className="space-y-4 font-sans text-sm">
          <label className="block">Event name
            <input className={eventInput} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>From (optional)
              <DatePicker type="date" min="1900-01-01" max="9999-12-30" className={eventInput} value={d.startsOn}
                onChange={e => setD({ ...d, startsOn: e.target.value })} />
            </label>
            <label>To (optional)
              <DatePicker type="date" min="1900-01-01" max="9999-12-30" className={eventInput} value={d.endsOn}
                onChange={e => setD({ ...d, endsOn: e.target.value })} />
            </label>
          </div>
          <FreeEventImageInput value={d.imagePath} disabled={busy || (!!id && revision === null)}
            onChange={imagePath => setD(current => ({ ...current, imagePath }))} onBusyChange={setUploadingImage} />
        </fieldset>
        {error && <p role="alert" className="font-sans text-sm text-red-700">{error}</p>}
        {id ? (
          <div className="border-t border-stone-200 pt-4">
            <h3 className="font-sans text-sm font-semibold text-slate-800">Delete event</h3>
            <p className="mt-1 font-sans text-sm text-slate-500">This permanently removes the event and all of its meetings.</p>
            <button type="button" disabled={busy || uploadingImage || revision === null || JSON.stringify(d) !== saved.current} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 font-sans text-sm text-red-700 hover:border-red-600 disabled:opacity-50" onClick={() => void remove()}>Delete event</button>
          </div>
        ) : (
          <button disabled={uploadingImage} className={freePrimary} onClick={() => send('/api/free-events', { action: 'create', event: d }).then(() => { refresh(); close(); }).catch(e => setError(e.message))}>Create event</button>
        )}
      </section>}
    </Panel>
  );
}
