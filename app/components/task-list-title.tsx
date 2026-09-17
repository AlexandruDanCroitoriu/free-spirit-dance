"use client";

import { useRef, useState } from 'react';

export default function TaskListTitle({ id, title, disabled, onRename }: {
  id: string; title: string; disabled: boolean; onRename: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false), [name, setName] = useState(title);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const cancelRef = useRef(false);
  function close(restoreFocus = false) {
    setEditing(false); setError('');
    if (restoreFocus) requestAnimationFrame(() => trigger.current?.focus());
  }
  async function save() {
    if (disabled || savingRef.current || cancelRef.current) return;
    const nextName = name.trim();
    if (!nextName) {
      setError('Enter a name of 1–100 characters.');
      input.current?.focus();
      return;
    }
    if (nextName === title) { close(); return; }
    savingRef.current = true;
    setSaving(true); setError('');
    try { await onRename(nextName); close(); }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename list.');
      input.current?.focus();
    } finally { savingRef.current = false; setSaving(false); }
  }
  if (!editing) return <h2 id={id} className="m-0 flex min-h-11 min-w-0 shrink-0 items-center text-sm font-bold">
    <button ref={trigger} type="button" disabled={disabled} aria-label={`Rename ${title} list`} title="Rename list" className="min-h-11 max-w-24 cursor-text truncate rounded px-1 text-left hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-lime-700 disabled:opacity-50" onKeyDown={event => event.stopPropagation()} onClick={() => { cancelRef.current = false; setName(title); setError(''); setEditing(true); }}>{title}</button>
  </h2>;
  return <form aria-label="Rename list" className="min-w-0 basis-full py-2 text-slate-800 [text-shadow:none]" onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !saving) { event.preventDefault(); cancelRef.current = true; close(true); }
  }} onSubmit={event => { event.preventDefault(); input.current?.blur(); }}>
    <input ref={input} id={id} aria-label="List name" autoFocus maxLength={100} value={name} disabled={disabled || saving} onFocus={event => event.target.select()} onBlur={() => void save()} onChange={event => { setName(event.target.value); if (error) setError(''); }} className="min-h-11 w-full rounded-lg border border-stone-400 bg-white px-2 text-sm outline-lime-700" />
    {error && <p role="alert" className="mb-0 rounded bg-white p-2 text-xs text-red-700">{error}</p>}
  </form>;
}
