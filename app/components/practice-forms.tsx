'use client';
import { useRef, useState } from 'react';
import { eventInput, parseSession, sessionEnd } from '../lib/practice-parties';
import { formatLogDate, schoolToday } from '../lib/student-activity';
import TimeSelector from './time-selector';
export type SessionDraft = { date: string; time: string; durationMinutes: number; offset: string };
export const newSession = (): SessionDraft => ({ date: schoolToday(), time: '20:00', durationMinutes: 120, offset: '' });
export function SessionFields({ value, onChange }: { value: SessionDraft; onChange: (value: SessionDraft) => void }) {
  const change = (patch: Partial<SessionDraft>) => onChange({ ...value, ...patch });
  let end = '', problem = '';
  try { end = sessionEnd(parseSession(value)); } catch (e) { problem = (e as Error).message; }
  return <div className="grid gap-3 sm:grid-cols-2">
    <label>Date<input required type="date" min="1900-01-01" max="9999-12-30" className={eventInput} value={value.date} onChange={e => change({ date: e.target.value })} /></label>
    <TimeSelector label="Start time (Bucharest)" value={value.time} onChange={time => change({ time })} />
    <label>Duration (minutes)<input required type="number" min={1} max={1440} step={1} className={eventInput} value={value.durationMinutes} onChange={e => change({ durationMinutes: Number(e.target.value) })} /></label>
    {(problem.includes('twice') || value.offset) && <label>Daylight-saving time<select required className={eventInput} value={value.offset} onChange={e => change({ offset: e.target.value })}><option value="">Choose which time</option><option value="summer">Summer time (UTC+3)</option><option value="winter">Winter time (UTC+2)</option></select></label>}
    <p className="m-0 text-xs text-slate-500 sm:col-span-2">{end ? `Ends ${formatLogDate(end)} · Free attendance, optional donation` : problem}</p>
  </div>;
}
export function useEventSave(url: string, saved: (result: { id: number }) => void) {
  const pending = useRef<string | null>(null), saving = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false);
  async function save(input: Record<string, unknown>) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    pending.current ??= JSON.stringify({ ...input, requestKey: crypto.randomUUID() });
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pending.current });
      const result = await response.json() as { id: number; error?: string };
      if (!response.ok) {
        if (response.status < 500) pending.current = null;
        throw new Error(result.error ?? 'Could not save.');
      }
      pending.current = null; setUncertain(false);
      window.dispatchEvent(new Event('student-activity-updated')); window.dispatchEvent(new Event('calendar-updated')); window.dispatchEvent(new Event('payment-transfer-updated'));
      saved(result);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not confirm save. Retry the same save.'); setUncertain(pending.current !== null); }
    finally { saving.current = false; setBusy(false); }
  }
  return { save, busy, error, uncertain };
}
