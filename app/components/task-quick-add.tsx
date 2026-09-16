"use client";
import { useRef, useState } from 'react';
import { TaskRequestError } from '../lib/tasks-client';

export default function TaskQuickAdd({ inbox = false, compact = false, disabled, onCreate }: {
  inbox?: boolean; compact?: boolean; disabled: boolean; onCreate: (title: string, key: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false), [title, setTitle] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false), [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ title: string; key: string } | null>(null);
  if (!open) return <button type="button" disabled={disabled} className={`${compact ? 'min-h-10 shrink-0' : 'min-h-11 w-full'} rounded-md px-2 text-left text-sm hover:bg-white/60 disabled:opacity-50`} onClick={() => setOpen(true)}>+ Add a card</button>;
  return <form aria-label={inbox ? 'Add Inbox card' : 'Add list card'} className={compact ? 'flex min-w-0 flex-1 items-center gap-1' : undefined} onSubmit={async event => {
    event.preventDefault(); if (saving || disabled || !title.trim()) return;
    pending.current ??= { title: title.trim(), key: crypto.randomUUID() }; setSaving(true); setError('');
    try { await onCreate(pending.current.title, pending.current.key); pending.current = null; setTitle(''); setUncertain(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not add card.'); if (reason instanceof TaskRequestError && reason.status < 500) { pending.current = null; setUncertain(false); } else setUncertain(true); }
    finally { setSaving(false); }
  }}>
    <input aria-label={inbox ? 'Inbox card title' : 'Card title'} autoFocus maxLength={200} required placeholder="Add a card" disabled={disabled || saving || uncertain} value={title} onChange={event => setTitle(event.target.value)} onBlur={() => { if (!saving && !uncertain) { setTitle(''); setOpen(false); } }} onKeyDown={event => { if (compact && event.key === 'Escape' && !saving) { setTitle(''); setOpen(false); } }} className={`${compact ? 'min-h-10 min-w-0 flex-1' : 'min-h-11 w-full'} rounded-md border border-stone-300 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400`} />
    {!compact && (title || !inbox) && <div className="mt-1 flex gap-2"><button disabled={disabled || saving || !title.trim()} className="min-h-11 rounded-md bg-slate-800 px-3 text-sm text-white disabled:opacity-50">{uncertain ? 'Retry' : 'Add card'}</button>{!inbox && <button type="button" aria-label="Cancel adding card" disabled={saving} className="min-h-11 px-3" onClick={() => setOpen(false)}>×</button>}</div>}
    {error && <p role="alert" className="text-xs text-red-700">{error}{uncertain && ' Retry to confirm the original request.'}</p>}
  </form>;
}
