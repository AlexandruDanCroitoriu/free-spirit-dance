'use client';
import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../lib/http';
import { eventButton as button, parseSession, sessionEnd, type EventDetail, type PracticeSession, type EventStudent } from '../lib/practice-parties';
import { formatLogDate, formatMoney } from '../lib/student-activity';
import { SessionFields, useEventSave, type SessionDraft } from './practice-forms';

export default function PracticePartyPanel({ id, onClose, initialTab }: { id: number; onClose: () => void; initialTab?: 'form' | 'attendance' | 'donations' }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<EventDetail | null>(null), [error, setError] = useState(''), [reload, setReload] = useState(0), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [tab, setTab] = useState<'form' | 'attendance' | 'donations'>(initialTab ?? 'attendance');
  useEffect(() => { const element = dialog.current, overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; element?.showModal(); return () => { element?.close(); document.body.style.overflow = overflow; }; }, []);
  useEffect(() => { const controller = new AbortController(); setError(''); requestJson<EventDetail>(`/api/practice-parties/${id}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }); return () => controller.abort(); }, [id, reload]);
  function saved() { setNotice('Saved.'); setReload(value => value + 1); }
  return <dialog ref={dialog} aria-label="Practice party" className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-3xl overflow-y-auto border-0 bg-stone-50 p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); }}>
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white p-5"><h1 className="m-0 text-2xl">Practice party</h1><button className={button} aria-label="Close practice party panel" disabled={busy} onClick={onClose}>Close</button></div>
    <div className="space-y-5 p-5">
      {error && <p role="alert" className="text-red-700">{error} <button className={button} onClick={() => setReload(value => value + 1)}>Reload</button></p>}{notice && <p role="status" className="text-lime-800">{notice}</p>}
      {!data ? <p>Loading practice party…</p> : <>
        <p className="font-sans text-sm">{formatLogDate(data.party.startsAt)} → {formatLogDate(sessionEnd(data.party))} · {data.party.durationMinutes} minutes · Bucharest time</p>
        <nav aria-label="Practice party sections" className="flex gap-5 border-b border-stone-200"><button type="button" className={`border-b-2 px-1 py-3 font-sans text-sm font-semibold ${tab === 'form' ? 'border-lime-600 text-slate-800' : 'border-transparent text-slate-500'}`} onClick={() => setTab('form')}>Practice party</button><button type="button" className={`border-b-2 px-1 py-3 font-sans text-sm font-semibold ${tab === 'attendance' ? 'border-lime-600 text-slate-800' : 'border-transparent text-slate-500'}`} onClick={() => setTab('attendance')}>Attendance</button><button type="button" className={`border-b-2 px-1 py-3 font-sans text-sm font-semibold ${tab === 'donations' ? 'border-lime-600 text-slate-800' : 'border-transparent text-slate-500'}`} onClick={() => setTab('donations')}>Donations</button></nav>
        {tab === 'form' && <EventSchedule key={`edit-${data.party.id}-${data.party.revision}`} data={data} saved={saved} onDeleted={onClose} setParentBusy={setBusy} />}
        {tab === 'attendance' && <Roster id={id} session={data.party} reload={reload} refresh={() => setReload(value => value + 1)} />}
        {tab === 'donations' && <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-xl">Donations</h2>
          <div className="flex flex-wrap gap-4 font-sans text-sm"><span>Received: <strong>{formatMoney(data.totals.receivedMinor)}</strong></span><span>Given to school: <strong>{formatMoney(data.totals.givenMinor)}</strong></span><span>Not yet given: <strong>{formatMoney(data.totals.pendingMinor)}</strong></span></div>
          <div className="space-y-3">{data.payments.map(payment => <article key={payment.id} className="rounded-lg border border-stone-200 p-3 font-sans text-sm"><div className="flex flex-wrap justify-between gap-2"><a className="underline" href={`/students/${payment.studentId}`}>{payment.studentName || 'Student'}</a><strong>{formatMoney(payment.amountMinor)}</strong></div><p className="text-xs">{formatLogDate(payment.paidOn)} · Collected by {payment.recordedBy}</p>{payment.notes && <p className="whitespace-pre-wrap">{payment.notes}</p>}<p className="text-xs">{payment.givenToSchool ? 'Given to school' : 'Not yet given to school'} · Manage transfers on the dashboard.</p></article>)}{!data.payments.length && <p>No donations recorded.</p>}</div>
        </section>}
      </>}
    </div>
  </dialog>;
}

function Roster({ id, session, reload, refresh }: { id: number; session: PracticeSession; reload: number; refresh: () => void }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [data, setData] = useState<{ students: EventStudent[]; count: number; paymentMethods: { method: string }[] } | null>(null), [error, setError] = useState(''), [donations, setDonations] = useState<Record<number, string>>({}), [donationMethods, setDonationMethods] = useState<Record<number, string>>({});
  const mutation = useEventSave(`/api/practice-parties/${id}`, () => { setDonations({}); setDonationMethods({}); refresh(); });
  useEffect(() => { const controller = new AbortController(); setError(''); const timer = window.setTimeout(() => { requestJson<{ students: EventStudent[]; count: number; paymentMethods: { method: string }[] }>(`/api/practice-parties/${id}/roster?${new URLSearchParams({ q: query, page: String(page) })}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setData(result); setDonations({}); setDonationMethods({}); } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }); }, 150); return () => { window.clearTimeout(timer); controller.abort(); }; }, [id, session.id, query, page, reload]);
  const editable = !session.cancelled;
  const active = data?.students.filter(student => student.active) ?? [], inactive = data?.students.filter(student => !student.active) ?? [];
  function toggle(student: EventStudent) {
    if (!editable || mutation.busy) return;
    void mutation.save({ action: 'attendance_batch', revision: session.revision, addStudentIds: student.attendanceId ? [] : [student.id], removeAttendanceIds: student.attendanceId ? [student.attendanceId] : [], donations: [] });
  }
  function saveDonation(student: EventStudent, method = (donationMethods[student.id] ?? student.donationReceivedMethod) || data?.paymentMethods[0]?.method || '') {
    const amount = donations[student.id], previous = student.donationAmountMinor === null ? '' : (student.donationAmountMinor / 100).toFixed(2);
    if (!editable || mutation.busy || !student.attendanceId || amount === undefined || amount === previous) return;
    if (amount && !method) return;
    void mutation.save({ action: 'attendance_batch', revision: session.revision, addStudentIds: [], removeAttendanceIds: [], donations: [{ studentId: student.id, amount, receivedMethod: method }] });
  }
  function card(student: EventStudent) {
    const attended = Boolean(student.attendanceId), savedDonation = student.donationAmountMinor === null ? '' : (student.donationAmountMinor / 100).toFixed(2);
    const method = (donationMethods[student.id] ?? student.donationReceivedMethod) || data?.paymentMethods[0]?.method || '';
    return <div key={student.id} className={`flex items-center gap-2 overflow-hidden rounded-xl border ${attended ? 'border-green-500 bg-green-50 text-green-900' : 'border-stone-200 bg-white hover:border-green-400'}`}><button type="button" aria-pressed={attended} disabled={!editable || mutation.busy} onClick={() => toggle(student)} className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-3 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-green-600"><span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 font-sans font-bold text-slate-800">{student.picture ? <img alt="" src={student.picture} className="h-full w-full object-cover" /> : `${student.firstName[0] ?? ''}${student.lastName[0] ?? ''}`}</span><span className="min-w-0 flex-1"><span className="block truncate font-sans text-sm font-semibold">{`${student.firstName} ${student.lastName}`.trim() || student.email || 'Student'}</span>{!student.active && <span className="mt-1 block font-sans text-xs text-slate-500">Inactive</span>}</span><span className="hidden font-sans text-xs font-semibold sm:block">{attended ? '✓ Recorded' : 'Record attendance'}</span></button><label className="w-28 shrink-0 pr-3 font-sans text-xs">Donation (RON)<input aria-label={`Donation for ${student.firstName} ${student.lastName}`} disabled={!editable || mutation.busy || !attended} inputMode="decimal" pattern="[0-9]{1,6}([.,][0-9]{1,2})?" className="mt-1 w-full rounded-md border border-stone-300 bg-white p-2 text-sm text-slate-800" value={donations[student.id] ?? savedDonation} onChange={event => setDonations(current => ({ ...current, [student.id]: event.target.value }))} onBlur={() => saveDonation(student)} /></label><label className="w-32 shrink-0 pr-3 font-sans text-xs">Received via<select disabled={!editable || mutation.busy || !attended} className="mt-1 w-full rounded-md border border-stone-300 bg-white p-2 text-sm text-slate-800" value={method} onChange={event => { const receivedMethod = event.target.value; setDonationMethods(current => ({ ...current, [student.id]: receivedMethod })); saveDonation(student, receivedMethod); }}>{(data?.paymentMethods ?? []).map(item => <option key={item.method} value={item.method}>{item.method}</option>)}</select></label></div>;
  }
  return <section className="space-y-5"><label className="block font-sans text-sm">Search students<input type="search" placeholder="Name, email, or phone" className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-slate-800" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>{error && <p role="alert" className="text-red-700">{error}</p>}{mutation.error && <p role="alert" className="text-red-700">{mutation.error}</p>}{session.cancelled && <p className="rounded-lg bg-red-50 p-3 font-sans text-sm text-red-700">This practice party is cancelled. Attendance cannot be changed.</p>}{data && <><section aria-labelledby="active-students-title"><h2 id="active-students-title" className="mb-3 text-xl font-normal">Active students ({active.length})</h2><div className="space-y-2">{active.map(card)}</div>{!active.length && <p className="font-sans text-sm text-slate-500">No active students.</p>}</section><section aria-labelledby="other-students-title"><h2 id="other-students-title" className="mb-3 text-xl font-normal">Other students ({inactive.length})</h2><div className="space-y-2">{inactive.map(card)}</div>{!inactive.length && <p className="font-sans text-sm text-slate-500">No other students.</p>}</section></>}<nav aria-label="Participant pages" className="flex items-center justify-between"><button className={button} disabled={page <= 1 || mutation.busy} onClick={() => setPage(value => value - 1)}>Previous</button><span className="text-sm">Page {page} of {Math.max(1, Math.ceil((data?.count ?? 0) / 100))}</span><button className={button} disabled={!data || page * 100 >= data.count} onClick={() => setPage(value => value + 1)}>Next</button></nav></section>;
}

function EventSchedule({ data, saved, onDeleted, setParentBusy }: { data: EventDetail; saved: () => void; onDeleted: () => void; setParentBusy: (busy: boolean) => void }) {
  const initial: SessionDraft = { date: data.party.startsAt.slice(0, 10), time: data.party.startsAt.slice(11, 16), durationMinutes: data.party.durationMinutes, offset: '' };
  const [schedule, setSchedule] = useState(initial);
  const mutation = useEventSave(`/api/practice-parties/${data.party.id}`, saved);
  const deletion = useEventSave(`/api/practice-parties/${data.party.id}`, onDeleted);
  const lastRequested = useRef(JSON.stringify(initial));
  useEffect(() => { setParentBusy(mutation.busy || deletion.busy); return () => setParentBusy(false); }, [mutation.busy, deletion.busy, setParentBusy]);
  useEffect(() => {
    const serialized = JSON.stringify(schedule);
    if (serialized === lastRequested.current) return;
    const timeout = window.setTimeout(() => {
      try {
        parseSession(schedule);
        lastRequested.current = serialized;
        void mutation.save({ action: 'edit_session', revision: data.party.revision, session: schedule });
      } catch {
        // SessionFields already shows invalid time and daylight-saving values.
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [schedule, data.party.revision]);
  function remove() {
    if (!window.confirm('Delete this practice party permanently? This cannot be undone.')) return;
    void deletion.save({ action: 'delete_session', revision: data.party.revision });
  }
  return <section aria-label="Correct date and time" className="space-y-4 rounded-xl border-2 border-lime-500 bg-white p-5 shadow-sm"><h2 className="text-xl">Correct date / time</h2><p className="font-sans text-sm text-slate-500">Changes save automatically.</p><fieldset disabled={mutation.busy || mutation.uncertain || deletion.busy} className="space-y-4 font-sans text-sm"><SessionFields value={schedule} onChange={setSchedule} /></fieldset>{mutation.error && <p role="alert" className="text-red-700">{mutation.error}</p>}{deletion.error && <p role="alert" className="text-red-700">{deletion.error}</p>}<div className="border-t border-stone-200 pt-4"><h3 className="font-sans text-sm font-semibold text-slate-800">Delete practice party</h3>{data.party.attendanceCount ? <p className="mt-1 font-sans text-sm text-slate-500">Remove all attendance before this practice party can be deleted.</p> : <><p className="mt-1 font-sans text-sm text-slate-500">This permanently removes the practice party.</p><button type="button" className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 font-sans text-sm text-red-700 hover:border-red-600 disabled:opacity-50" disabled={mutation.busy || mutation.uncertain || deletion.busy || deletion.uncertain} onClick={remove}>Delete practice party</button></>}</div></section>;
}
