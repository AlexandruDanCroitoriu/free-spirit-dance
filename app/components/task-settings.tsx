"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { taskColors, type TaskColor } from '../lib/task-colors';

export default function TaskSettings({ label, color = 'default', disabled, onColor, onRemove, triggerLabel, colorOnly = false, children }: {
  label: string; color?: TaskColor; disabled: boolean; onColor: (color: TaskColor) => Promise<void>;
  onRemove?: () => Promise<void>; children?: ReactNode;
  triggerLabel?: string; colorOnly?: boolean;
}) {
  const id = useId(), popover = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [colors, setColors] = useState(false), [removing, setRemoving] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const menu = popover.current!, button = trigger.current!;
    function place() {
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const margin = 12, gap = 8;
      const anchor = button.getBoundingClientRect();
      menu.style.width = `${Math.min(264, Math.max(0, width - margin * 2))}px`;
      menu.style.maxHeight = `${Math.max(0, height - margin * 2)}px`;
      const naturalHeight = menu.getBoundingClientRect().height;
      const below = y + height - margin - anchor.bottom - gap;
      const above = anchor.top - gap - y - margin;
      const upward = below < naturalHeight && above > below;
      menu.style.maxHeight = `${Math.max(0, Math.min(height - margin * 2, upward ? above : below))}px`;
      const size = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(x + margin, Math.min(anchor.right - size.width, x + width - margin - size.width))}px`;
      menu.style.top = `${Math.max(y + margin, Math.min(upward ? anchor.top - gap - size.height : anchor.bottom + gap, y + height - margin - size.height))}px`;
      menu.style.visibility = 'visible';
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      menu.style.visibility = 'hidden';
    };
  }, [open, colors, removing]);
  function close() { popover.current?.hidePopover(); trigger.current?.focus(); }
  return <>
    <button ref={trigger} type="button" popoverTarget={id} disabled={disabled} onClick={() => {
      setColors(colorOnly); setRemoving(false); setError('');
    }} aria-label={triggerLabel ?? `${label} settings`} className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 disabled:opacity-50 ${triggerLabel ? 'px-3 font-semibold' : 'min-w-11'}`}>{triggerLabel ?? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 3-.6 2.3-2 .9-2.1-.7-2 3.5 1.6 1.6v2.3L2.3 15l2 3.5 2.1-.6 2-.9L9 21h4l.6-2.2 2-.9 2.1.6 2-3.5-1.6-2.1v-2.3L19.7 9l-2-3.5-2.1.7-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></svg>}</button>
    <div ref={popover} id={id} popover="auto" onToggle={event => setOpen(event.newState === 'open')} aria-label={`${label} options`} style={{visibility: 'hidden'}} className="task-scrollbar fixed inset-auto m-0 box-border w-64 overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-[#242528] p-1.5 font-sans text-sm text-stone-200 shadow-lg shadow-black/30 [color-scheme:dark] [text-shadow:none]">
      {colors ? <div role="group" aria-label={`${label} colors`} className="grid grid-cols-4 gap-2 p-1">{taskColors.map(preset => <button type="button" key={preset.key} aria-label={preset.name} aria-pressed={color === preset.key} title={preset.name} disabled={disabled || saving} style={{background: preset.background}} className={`flex min-h-11 items-center justify-center rounded-lg border border-white/20 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${preset.background.startsWith('linear') ? 'col-span-2 h-16' : ''}`} onClick={async () => { await onColor(preset.key); close(); }}>{color === preset.key && <span className="rounded-full bg-slate-950/80 px-1.5 text-white" aria-hidden="true">✓</span>}</button>)}</div> : removing ? <div className="space-y-3 p-3"><p className="m-0 leading-5 text-stone-300">Remove this list? Move or delete all of its cards first.</p>{error && <p role="alert" className="m-0 text-red-300">{error}</p>}<div className="flex gap-2"><button type="button" disabled={disabled || saving} className="min-h-11 rounded-lg bg-red-700 px-3 font-semibold text-white disabled:opacity-50" onClick={async () => { if (!onRemove) return; setSaving(true); setError(''); try { await onRemove(); close(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not remove this list.'); } finally { setSaving(false); } }}>{saving ? 'Removing…' : 'Remove list'}</button><button type="button" disabled={saving} className="min-h-11 rounded-lg px-3 hover:bg-white/10" onClick={() => setRemoving(false)}>Cancel</button></div></div> : <div className="grid gap-0.5">{children}<button type="button" disabled={disabled} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors hover:bg-white/10" onClick={() => setColors(true)}><span aria-hidden="true" className="h-4 w-4 rounded-full border border-white/20" style={{ background: taskColors.find(preset => preset.key === color)?.background }} />Change color</button>{onRemove && <button type="button" disabled={disabled} className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-left font-medium text-red-300 transition-colors hover:bg-red-400/10" onClick={() => setRemoving(true)}><span aria-hidden="true" className="text-lg leading-none">−</span>Remove list</button>}</div>}
    </div>
  </>;
}
