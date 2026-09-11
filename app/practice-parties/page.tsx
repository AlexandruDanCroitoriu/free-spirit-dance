'use client';
import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../lib/http';
import { eventButton, eventPrimary, sessionEnd, type PracticeSession } from '../lib/practice-parties';
import { formatLogDate } from '../lib/student-activity';
import { newSession, SessionFields, useEventSave } from '../components/practice-forms';
import PracticePartyPanel from '../components/practice-party-panel';
export default function PracticePartiesPage() {
  const [parties, setParties] = useState<PracticeSession[]>([]), [open, setOpen] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true), [reload, setReload] = useState(0), [selected, setSelected] = useState<{ id: number; tab: 'form' | 'attendance' | 'donations' } | null>(null);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(''); requestJson<PracticeSession[]>('/api/practice-parties', { signal: controller.signal }).then(d => { if (!controller.signal.aborted) setParties(d); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [reload]);
  useEffect(() => { const open = () => setOpen(true); window.addEventListener('open-add-practice-party', open); return () => window.removeEventListener('open-add-practice-party', open); }, []);
  return <main className="mx-auto w-full max-w-6xl space-y-5 p-6 md:p-10">
    {open && <CreatePractice close={() => setOpen(false)} saved={() => { setOpen(false); setReload(v => v + 1); }} />}
    {error && <p role="alert">{error} <button className={eventButton} onClick={() => setReload(v => v + 1)}>Retry</button></p>}
    {loading ? <p role="status">Loading practice parties…</p> : <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">{!parties.length && !error ? <p className="p-8 text-center font-sans text-sm text-slate-500">No recorded practice parties yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left font-sans text-sm"><caption className="sr-only">Recorded practice parties</caption><thead className="bg-stone-50 text-xs uppercase tracking-wider text-slate-500"><tr><th scope="col" className="px-5 py-3">Date</th><th scope="col" className="px-5 py-3">Time</th><th scope="col" className="px-5 py-3">Duration</th><th scope="col" className="px-5 py-3">Attendance</th><th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y divide-stone-200">{parties.map(p => <tr key={p.id} role="button" tabIndex={0} aria-label={`Edit practice party on ${formatLogDate(p.startsAt.slice(0, 10))}`} className="cursor-pointer hover:bg-stone-50 focus:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lime-600" onClick={() => setSelected({ id: p.id, tab: 'form' })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected({ id: p.id, tab: 'form' }); } }}><td className="whitespace-nowrap px-5 py-4 font-semibold">{formatLogDate(p.startsAt.slice(0, 10))}{p.cancelled && <span className="block text-xs font-normal text-slate-500">Cancelled</span>}</td><td className="whitespace-nowrap px-5 py-4">{p.startsAt.slice(11)}–{sessionEnd(p).slice(11)}</td><td className="whitespace-nowrap px-5 py-4">{p.durationMinutes} minutes</td><td className="whitespace-nowrap px-5 py-4">{p.attendanceCount} attended</td><td className="px-5 py-4"><div className="flex justify-end"><button className={eventPrimary} onClick={event => { event.stopPropagation(); setSelected({ id: p.id, tab: 'attendance' }); }}>Attendance & details</button></div></td></tr>)}</tbody></table></div>}</section>}
    {selected !== null && <PracticePartyPanel id={selected.id} initialTab={selected.tab} onClose={() => { setSelected(null); setReload(v => v + 1); }} />}
  </main>;
}
function CreatePractice({ saved, close }: { saved: () => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(newSession());
  const mutation = useEventSave('/api/practice-parties', saved);
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; };
  }, []);
  return <dialog ref={dialog} aria-label="Add practice party" className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-3xl overflow-y-auto border-0 bg-stone-50 p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60" onCancel={event => { event.preventDefault(); if (!mutation.busy) close(); }} onClick={event => { if (event.target !== event.currentTarget || mutation.busy) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); }}>
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white p-5"><h2 className="m-0 text-2xl">Add practice party</h2><button type="button" className={eventButton} aria-label="Close add practice party panel" disabled={mutation.busy} onClick={close}>Close</button></div>
    <form className="space-y-4 p-5" onSubmit={e => { e.preventDefault(); void mutation.save({ action: 'create', session }); }}>
      <fieldset disabled={mutation.busy || mutation.uncertain} className="space-y-4 font-sans text-sm"><SessionFields value={session} onChange={setSession} /></fieldset>
      {mutation.error && <p role="alert" className="text-red-700">{mutation.error}</p>}{mutation.uncertain && <p>Retry sends the same entry to prevent duplicates.</p>}<div className="flex gap-3"><button className={eventPrimary} disabled={mutation.busy}>{mutation.busy ? 'Saving…' : mutation.uncertain ? 'Retry same save' : 'Save practice party'}</button><button type="button" className={eventButton} disabled={mutation.busy} onClick={close}>Cancel</button></div>
    </form>
  </dialog>;
}
