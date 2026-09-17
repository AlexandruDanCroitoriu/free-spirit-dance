'use client';
import { useEffect, useRef, useState } from 'react';
import { freeButton, freePrimary, formatFreeDate, parseMeeting, type FreeEvent, type FreeMeeting } from '../lib/free-events';
import { eventInput } from '../lib/practice-parties';
import { confirmAction } from '../lib/confirmation';
import { requestJson } from '../lib/http';
import { newSession, SessionFields } from './practice-forms';
import FreeMeetingRoster from './free-meeting-roster';
import FreeEventHistory from './free-event-history';

type Tab = 'details' | 'attendance' | 'history';
export default function MeetingPanel({ event, meeting, close, refresh, initialTab = 'details' }: { event: FreeEvent; meeting?: FreeMeeting; close: () => void; refresh: () => void; initialTab?: Tab }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>(meeting ? initialTab : 'details');
  const [current, setCurrent] = useState(meeting);
  const [draft, setDraft] = useState(() => meeting ? { name: meeting.name, date: meeting.startsAt.slice(0, 10), time: meeting.startsAt.slice(11, 16), durationMinutes: meeting.durationMinutes, offset: '', spaceRent: (meeting.spaceRentMinor / 100).toFixed(2), acceptsDonations: Boolean(meeting.acceptsDonations) } : { name: '', ...newSession(), spaceRent: '0', acceptsDonations: false });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [attendanceDirty, setAttendanceDirty] = useState(false);
  const [revision, setRevision] = useState(meeting?.revision ?? 0), [historyVersion, setHistoryVersion] = useState(0);
  const saved = useRef(JSON.stringify(draft)), saving = useRef(false);
  const dirty = Boolean(meeting) && JSON.stringify(draft) !== saved.current;
  const base = `/api/free-events/${event.id}/meetings`;
  useEffect(() => {
    const element = dialog.current, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; };
  }, []);
  async function send(body: object, creating = false) {
    return requestJson<{ id: number }>(creating ? base : `${base}/${meeting!.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function notify() {
    refresh(); setHistoryVersion(value => value + 1);
    window.dispatchEvent(new Event('calendar-updated')); window.dispatchEvent(new Event('payment-transfer-updated'));
  }
  async function save() {
    if (saving.current) return;
    try { parseMeeting(draft); } catch (reason) { setError((reason as Error).message); return; }
    saving.current = true; setBusy(true); setError('');
    try {
      await send({ action: meeting ? 'update' : 'create', revision, meeting: draft }, !meeting);
      saved.current = JSON.stringify(draft);
      setRevision(value => value + 1);
      if (meeting) setCurrent({ ...meeting, ...parseMeeting(draft), revision: revision + 1 });
      notify(); if (!meeting) close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save meeting.'); }
    finally { saving.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!dirty || busy || error) return;
    const timer = window.setTimeout(() => void save(), 500);
    return () => window.clearTimeout(timer);
  }, [draft, busy, dirty, error]);
  async function onClose() {
    if (busy) return;
    if ((dirty || attendanceDirty) && !await confirmAction('Discard unsaved changes?', 'Some changes have not been saved. Close this meeting and discard them?', 'Discard changes', true)) return;
    close();
  }
  async function remove() {
    if (!meeting || busy || !await confirmAction('Delete meeting?', 'This permanently removes the meeting, its attendance and donations.', 'Delete meeting', true)) return;
    setBusy(true);
    try { await send({ action: 'delete', revision }); notify(); close(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function attendanceSaved() {
    notify();
    try {
      const detail = await requestJson<{ meetings: FreeMeeting[] }>(`/api/free-events/${event.id}`);
      const updated = detail.meetings.find(item => item.id === meeting?.id);
      if (updated) { setCurrent(updated); setRevision(updated.revision); }
    } catch (reason) { setError((reason as Error).message); }
  }
  return <dialog ref={dialog} aria-label={meeting ? meeting.name : 'Add meeting'} className="fixed inset-0 m-0 box-border h-dvh max-h-none w-auto max-w-none overflow-y-auto border-0 bg-stone-50 p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60 md:inset-y-0 md:left-auto md:w-full md:max-w-3xl" onCancel={e => { e.preventDefault(); void onClose(); }}>
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white p-5"><h1 className="m-0 text-2xl">{meeting ? current?.name : 'Add meeting'}</h1><button className={freeButton} disabled={busy} onClick={() => void onClose()}>Close</button></header>
    <div className="space-y-5 p-5">
      {current && <><p className="font-sans text-sm text-slate-500">{event.name} · {formatFreeDate(current.startsAt)} · {current.startsAt.slice(11, 16)} · {current.durationMinutes} minutes · Bucharest time</p>
        <nav aria-label="Meeting sections" className="flex gap-5 border-b border-stone-200">{(['details', 'attendance', 'history'] as const).map(item => <button key={item} type="button" aria-current={tab === item ? 'page' : undefined} disabled={busy || (dirty && item !== tab)} className={`border-b-2 px-1 py-3 font-sans text-sm font-semibold disabled:opacity-50 ${tab === item ? 'border-lime-600 text-slate-800' : 'border-transparent text-slate-500'}`} onClick={() => setTab(item)}>{item === 'details' ? 'Meeting details' : item === 'attendance' ? 'Attendance' : 'History'}</button>)}</nav></>}
      {error && <p role="alert" className="font-sans text-sm text-red-700">{error} {dirty && <button className={freeButton} disabled={busy} onClick={() => void save()}>Retry save</button>}</p>}
      <section hidden={tab !== 'details'} aria-label="Meeting details" className="space-y-4 rounded-xl border-2 border-lime-500 bg-white p-5 shadow-sm">
        <h2 className="text-xl">Meeting details</h2><p className="font-sans text-sm text-slate-500">{meeting ? busy ? 'Saving…' : 'Changes save automatically.' : 'Set up the meeting below.'}</p>
        {attendanceDirty && <p className="font-sans text-sm text-slate-500">Submit attendance changes before editing meeting details.</p>}
        <fieldset disabled={busy || attendanceDirty} className="space-y-4 font-sans text-sm" onChange={() => setError('')}>
          <label className="block">Meeting name<input maxLength={160} className={eventInput} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          <SessionFields value={draft} onChange={value => { setError(''); setDraft({ ...draft, ...value }); }} />
          <label className="block">Space rent cost (RON)<input inputMode="decimal" className={eventInput} value={draft.spaceRent} onChange={e => setDraft({ ...draft, spaceRent: e.target.value })} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={draft.acceptsDonations} onChange={e => setDraft({ ...draft, acceptsDonations: e.target.checked })} />Can receive donations</label>
        </fieldset>
        {meeting ? <div className="border-t border-stone-200 pt-4"><button disabled={busy || dirty || attendanceDirty} className="rounded-lg border border-red-300 bg-white px-3 py-2 font-sans text-sm text-red-700 disabled:opacity-50" onClick={() => void remove()}>Delete meeting</button></div> : <button className={freePrimary} disabled={busy} onClick={() => void save()}>Create meeting</button>}
      </section>
      {current && <div hidden={tab !== 'attendance'}><FreeMeetingRoster eventId={event.id} session={current} setDirty={setAttendanceDirty} refresh={() => void attendanceSaved()} /></div>}
      {meeting && tab === 'history' && <FreeEventHistory eventId={event.id} meetingId={meeting.id} revision={historyVersion} />}
    </div>
  </dialog>;
}
