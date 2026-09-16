"use client";

import { useRef, useState } from 'react';
import { TaskRequestError } from '../lib/tasks-client';

export default function TaskContainerComposer({ disabled, onCreate }: {
  disabled: boolean; onCreate: (name: string, requestKey: string) => Promise<void>;
}) {
  const kind = 'list';
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<{ name: string; requestKey: string } | null>(null);
  const button = 'min-h-11 rounded-lg px-3 font-sans text-sm font-semibold disabled:opacity-50';
  if (!open) return <button type="button" disabled={disabled} className={`${button} w-full border border-stone-300 bg-white/80 text-left hover:bg-white`} onClick={() => setOpen(true)}>+ Add another list</button>;
  return <form aria-label={`Create ${kind}`} className="min-w-0 font-sans" onSubmit={async event => {
    event.preventDefault(); if (saving || disabled || !name.trim()) return;
    pending.current ??= { name: name.trim(), requestKey: crypto.randomUUID() };
    setSaving(true); setError('');
    try {
      await onCreate(pending.current.name, pending.current.requestKey);
      pending.current = null; setName(''); setUncertain(false); setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not create ${kind}.`);
      if (reason instanceof TaskRequestError && reason.status < 500) { pending.current = null; setUncertain(false); }
      else setUncertain(true);
    } finally { setSaving(false); }
  }}>
    <label><span className="sr-only">List name</span><input autoFocus required maxLength={100} disabled={disabled || saving} readOnly={uncertain} value={name} onChange={event => setName(event.target.value)} placeholder={`Enter ${kind} name…`} className="min-h-11 w-full rounded-lg border border-stone-400 bg-white px-3 text-sm outline-lime-700" onBlur={() => { if (!saving) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape' && !saving) setOpen(false); }} /></label>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {uncertain && <p className="text-xs">The request may have succeeded. Press Enter to retry and confirm it.</p>}
  </form>;
}
