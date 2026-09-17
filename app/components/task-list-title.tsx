"use client";

import { useRef, useState } from 'react';

export default function TaskListTitle({ id, title, disabled, onRename }: {
  id: string; title: string; disabled: boolean; onRename: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false), [name, setName] = useState(title);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  function close() {
    setEditing(false); setError('');
    requestAnimationFrame(() => trigger.current?.focus());
  }
  if (!editing) return <h2 id={id} className="m-0 flex min-h-11 min-w-0 shrink-0 items-center text-sm font-bold">
    <button ref={trigger} type="button" disabled={disabled} aria-label={`Rename ${title} list`} title="Rename list" className="min-h-11 max-w-24 cursor-text truncate rounded px-1 text-left hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-lime-700 disabled:opacity-50" onKeyDown={event => event.stopPropagation()} onClick={() => { setName(title); setError(''); setEditing(true); }}>{title}</button>
  </h2>;
  return <form aria-label="Rename list" className="min-w-0 basis-full py-2 text-slate-800 [text-shadow:none]" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !saving) { event.preventDefault(); close(); }
  }} onSubmit={async event => {
    event.preventDefault();
    if (disabled || saving) return;
    if (!name.trim()) { setError('Enter a name of 1–100 characters.'); return; }
    if (name.trim() === title) { close(); return; }
    setSaving(true); setError('');
    try { await onRename(name.trim()); close(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not rename list.'); }
    finally { setSaving(false); }
  }}>
    <input id={id} aria-label="List name" autoFocus maxLength={100} value={name} disabled={disabled || saving} onFocus={event => event.target.select()} onChange={event => setName(event.target.value)} className="min-h-11 w-full rounded-lg border border-stone-400 bg-white px-2 text-sm outline-lime-700" />
    <div className="mt-1 flex gap-1 text-sm">
      <button type="submit" disabled={disabled || saving} className="min-h-11 rounded-lg bg-lime-700 px-3 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" disabled={saving} onClick={close} className="min-h-11 rounded-lg bg-white px-3 disabled:opacity-50">Cancel</button>
    </div>
    {error && <p role="alert" className="mb-0 rounded bg-white p-2 text-xs text-red-700">{error}</p>}
  </form>;
}
