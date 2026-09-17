'use client';
import { useEffect, useState } from 'react';
import { requestJson } from '../lib/http';
import { eventButton as button, type EventStudent } from '../lib/practice-parties';
import type { FreeMeeting } from '../lib/free-events';
import { useEventSave } from './practice-forms';

export default function FreeMeetingRoster({ eventId, session, refresh, setDirty }: { eventId: number; session: FreeMeeting; refresh: () => void; setDirty: (dirty: boolean) => void }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [data, setData] = useState<{ students: EventStudent[]; count: number; paymentMethods: { method: string }[]; revision: number } | null>(null), [error, setError] = useState(''), [attendanceChanges, setAttendanceChanges] = useState<Record<number, boolean>>({}), [donations, setDonations] = useState<Record<number, string>>({}), [donationMethods, setDonationMethods] = useState<Record<number, string>>({});
  const [reload, setReload] = useState(0);
  const [revision, setRevision] = useState(session.revision);
  const mutation = useEventSave(`/api/free-events/${eventId}/meetings/${session.id}/roster`, () => { setAttendanceChanges({}); setDonations({}); setDonationMethods({}); setReload(value => value + 1); refresh(); });
  useEffect(() => { const controller = new AbortController(); setError(''); setData(null); const timer = window.setTimeout(() => { requestJson<{ students: EventStudent[]; count: number; paymentMethods: { method: string }[]; revision: number }>(`/api/free-events/${eventId}/meetings/${session.id}/roster?${new URLSearchParams({ q: query, page: String(page) })}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setData(result); setRevision(result.revision); } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }); }, 150); return () => { window.clearTimeout(timer); controller.abort(); }; }, [eventId, session.id, session.revision, query, page, reload]);
  const editable = !session.cancelled;
  const attended = (student: EventStudent) => attendanceChanges[student.id] ?? Boolean(student.attendanceId);
  // Keep every card in its original server-defined section while the draft is
  // being edited. Moving it before submit makes the sidebar appear to jump.
  const recorded = data?.students.filter(student => Boolean(student.attendanceId)) ?? [];
  const active = data?.students.filter(student => student.active && !student.attendanceId) ?? [];
  const inactive = data?.students.filter(student => !student.active && !student.attendanceId) ?? [];
  const attendanceChangeCount = Object.keys(attendanceChanges).length;
  function toggle(student: EventStudent) {
    if (!editable || mutation.busy) return;
    if (attended(student)) {
      setDonations(current => { const next = { ...current }; delete next[student.id]; return next; });
      setDonationMethods(current => { const next = { ...current }; delete next[student.id]; return next; });
    }
    setAttendanceChanges(current => {
      const next = { ...current }, value = !attended(student);
      if (value === Boolean(student.attendanceId)) delete next[student.id]; else next[student.id] = value;
      return next;
    });
  }
  function submit() {
    if (!data || !editable || mutation.busy) return;
    const addStudentIds = data.students.filter(student => attended(student) && !student.attendanceId).map(student => student.id);
    const removeAttendanceIds = data.students.filter(student => !attended(student) && student.attendanceId).map(student => student.attendanceId!);
    const donationsToSave = data.students.flatMap(student => {
      if (!attended(student) || (donations[student.id] === undefined && donationMethods[student.id] === undefined)) return [];
      const amount = donations[student.id] ?? (student.donationAmountMinor === null ? '' : (student.donationAmountMinor / 100).toFixed(2));
      const receivedMethod = (donationMethods[student.id] ?? student.donationReceivedMethod) || data.paymentMethods[0]?.method || '';
      return [{ studentId: student.id, amount, receivedMethod }];
    });
    if (!addStudentIds.length && !removeAttendanceIds.length && !donationsToSave.length) return;
    void mutation.save({ action: 'attendance_batch', revision, addStudentIds, removeAttendanceIds, donations: donationsToSave });
  }
  function card(student: EventStudent) {
    const isAttended = attended(student), savedDonation = student.donationAmountMinor === null ? '' : (student.donationAmountMinor / 100).toFixed(2);
    const method = (donationMethods[student.id] ?? student.donationReceivedMethod) || data?.paymentMethods[0]?.method || '';
    const name = `${student.firstName} ${student.lastName}`.trim() || student.email || 'Student';
    return <div key={student.id} className={`flex gap-3 overflow-hidden rounded-xl border p-3 ${isAttended ? 'border-green-500 bg-green-50 text-green-900' : 'border-stone-200 bg-white hover:border-green-400'}`}><button type="button" aria-label={`Toggle attendance for ${name}`} aria-pressed={isAttended} disabled={!editable || mutation.busy || mutation.uncertain} onClick={() => toggle(student)} className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-0 bg-lime-200 font-sans font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-green-600">{student.picture ? <img alt="" src={student.picture} className="h-full w-full object-cover" /> : `${student.firstName[0] ?? ''}${student.lastName[0] ?? ''}`}</button><div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3"><div className="min-w-0 sm:flex-1"><button type="button" aria-pressed={isAttended} disabled={!editable || mutation.busy || mutation.uncertain} onClick={() => toggle(student)} className="block w-full truncate border-0 bg-transparent p-0 text-left font-sans text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-inset focus:ring-green-600">{name}</button>{!student.active && <span className="mt-1 block font-sans text-xs text-slate-500">Inactive</span>}</div><div className="mt-2 flex gap-2 sm:mt-0 sm:w-72 sm:shrink-0"><input type="number" min="0" step="10" aria-label={`Donation for ${name}`} placeholder="Donation" disabled={!editable || mutation.busy || mutation.uncertain || !isAttended} inputMode="decimal" className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white p-2 text-sm text-slate-800" value={donations[student.id] ?? savedDonation} onChange={event => setDonations(current => ({ ...current, [student.id]: event.target.value }))} /><select aria-label={`Payment method for ${name}`} disabled={!editable || mutation.busy || mutation.uncertain || !isAttended} className="min-w-0 flex-1 rounded-md border border-stone-300 bg-white p-2 text-sm text-slate-800" value={method} onChange={event => setDonationMethods(current => ({ ...current, [student.id]: event.target.value }))}>{(data?.paymentMethods ?? []).map(item => <option key={item.method} value={item.method}>{item.method}</option>)}</select></div></div></div>;
  }
  const hasChanges = attendanceChangeCount || Object.keys(donations).length || Object.keys(donationMethods).length;
  useEffect(() => { setDirty(Boolean(hasChanges) || mutation.busy || mutation.uncertain); }, [hasChanges, mutation.busy, mutation.uncertain, setDirty]);
  return <section className="space-y-5"><label className="block font-sans text-sm">Search students<input type="search" disabled={Boolean(hasChanges) || mutation.busy || mutation.uncertain} placeholder="Name, email, or phone" className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-slate-800" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>{!!hasChanges && <p className="font-sans text-xs text-slate-500">Submit your attendance changes before searching or changing pages.</p>}{error && <p role="alert" className="text-red-700">{error}</p>}{mutation.error && <p role="alert" className="text-red-700">{mutation.error}</p>}{session.cancelled && <p className="rounded-lg bg-red-50 p-3 font-sans text-sm text-red-700">This meeting is cancelled. Attendance cannot be changed.</p>}{data && <><section aria-labelledby="recorded-students-title"><h2 id="recorded-students-title" className="mb-3 text-xl font-normal">Recorded students ({recorded.length})</h2><div className="space-y-2">{recorded.map(card)}</div>{!recorded.length && <p className="font-sans text-sm text-slate-500">No students recorded yet.</p>}</section><section aria-labelledby="active-students-title"><h2 id="active-students-title" className="mb-3 text-xl font-normal">Active students ({active.length})</h2><div className="space-y-2">{active.map(card)}</div>{!active.length && <p className="font-sans text-sm text-slate-500">No other active students.</p>}</section><section aria-labelledby="other-students-title"><h2 id="other-students-title" className="mb-3 text-xl font-normal">Other students ({inactive.length})</h2><div className="space-y-2">{inactive.map(card)}</div>{!inactive.length && <p className="font-sans text-sm text-slate-500">No other students.</p>}</section></>}<nav aria-label="Participant pages" className="flex items-center justify-between"><button className={button} disabled={page <= 1 || mutation.busy || Boolean(hasChanges) || mutation.uncertain} onClick={() => setPage(value => value - 1)}>Previous</button><span className="text-sm">Page {page} of {Math.max(1, Math.ceil((data?.count ?? 0) / 100))}</span><button className={button} disabled={!data || page * 100 >= data.count || Boolean(hasChanges) || mutation.uncertain} onClick={() => setPage(value => value + 1)}>Next</button></nav><footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-stone-200 bg-white p-5"><p className="m-0 font-sans text-xs text-slate-500">{attendanceChangeCount} changes · {recorded.length} recorded</p><button type="button" className="rounded-md bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-white disabled:opacity-50" disabled={!editable || mutation.busy || !hasChanges} onClick={submit}>{mutation.busy ? 'Saving…' : 'Submit attendance'}</button></footer></section>;
}
