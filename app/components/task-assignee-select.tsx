"use client";

import { useEffect, useId, useRef, useState } from 'react';

type Administrator = { email: string; name: string; picture: string | null };

function Avatar({ administrator }: { administrator?: Administrator }) {
  const picture = administrator?.picture;
  return <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-purple-200 text-xs font-semibold text-purple-950">
    {picture && /^\/(?!\/)/.test(picture) ? <img src={picture} alt="" className="h-full w-full object-cover" /> : administrator ? administrator.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('') : '—'}
  </span>;
}

export default function TaskAssigneeSelect({ administrators, value, onChange, disabled }: {
  administrators: Administrator[]; value: string | null; onChange: (email: string | null) => void; disabled: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = administrators.find(person => person.email === value);
  const choices = [null, ...administrators];
  useEffect(() => {
    if (!open) return;
    const element = popup.current!;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const below = top + height - rect.bottom - 12, above = rect.top - top - 12;
      const downward = below >= Math.min(240, above);
      element.style.width = `${Math.min(Math.max(rect.width, 220), width - 24)}px`;
      element.style.maxHeight = `${Math.max(44, Math.min(280, downward ? below : above))}px`;
      element.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - element.offsetWidth - 12))}px`;
      element.style.top = `${downward ? rect.bottom + 4 : Math.max(top + 12, rect.top - element.offsetHeight - 4)}px`;
    };
    place();
    element.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); };
  }, [open]);
  useEffect(() => { if (disabled) popup.current?.hidePopover(); }, [disabled]);
  return <div className="min-w-0">
    <span id={`${id}-label`} className="block">Assigned administrator</span>
    <button ref={trigger} type="button" disabled={disabled} popoverTarget={id} aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-lg border border-white/20 bg-[#292a2c] px-3 py-2 text-left text-stone-100 focus-visible:outline-blue-400 disabled:opacity-50">
      <Avatar administrator={selected} /><span id={`${id}-value`} className="min-w-0 flex-1 truncate">{selected?.name ?? value ?? 'Unassigned'}</span><span aria-hidden="true">⌄</span>
    </button>
    <div ref={popup} id={id} popover="auto" role="dialog" aria-labelledby={`${id}-label`} onToggle={event => setOpen(event.newState === 'open')} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); popup.current?.hidePopover(); trigger.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const buttons = [...popup.current!.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    }} className="fixed m-0 overflow-y-auto rounded-lg border border-white/20 bg-[#292a2c] p-1 font-sans text-sm text-stone-100 shadow-xl">
      <div role="radiogroup" aria-label="Assigned administrator">{choices.map(person => <button key={person?.email ?? 'unassigned'} type="button" role="radio" aria-checked={(person?.email ?? null) === value} disabled={disabled} onClick={() => { onChange(person?.email ?? null); popup.current?.hidePopover(); trigger.current?.focus(); }} className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-white/10 focus-visible:outline-blue-400 aria-checked:bg-purple-900 aria-checked:text-purple-50">
        <Avatar administrator={person ?? undefined} /><span className="min-w-0 flex-1 break-words">{person?.name ?? 'Unassigned'}</span>{(person?.email ?? null) === value && <span aria-hidden="true">✓</span>}
      </button>)}</div>
    </div>
  </div>;
}
