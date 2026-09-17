'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { PaymentStudent } from '../lib/student-activity';
import { requestJson } from '../lib/http';

const inputClass = 'mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm';
function StudentAvatar({ student }: { student: PaymentStudent }) {
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-100 text-[10px] font-semibold text-lime-900">
    {student.picture ? <img src={student.picture} alt="" className="h-full w-full object-cover" /> : `${student.firstName[0] ?? ''}${student.lastName[0] ?? ''}`}
  </span>;
}

export default function PaymentGroupFields({ payerId, group, count, selected, onGroup, onCount, onSelected }: {
  payerId: number; group: boolean; count: string; selected: number[];
  onGroup: (value: boolean) => void; onCount: (value: string) => void; onSelected: (value: number[]) => void;
}) {
  const [students, setStudents] = useState<PaymentStudent[]>([]);
  const [open, setOpen] = useState(false);
  const dropdown = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dropdownId = useId();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!dropdown.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!group) return;
    let cancelled = false;
    setLoading(true); setError('');
    requestJson<PaymentStudent[]>('/api/students').then(items => {
      if (!cancelled) setStudents(items.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)));
    }).catch(() => { if (!cancelled) setError('Could not load students.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [group, retry]);
  return <>
    <fieldset className="border-0 p-0"><legend>Payment type</legend><div className="mt-2 flex gap-2">{[false, true].map(value => <button key={String(value)} type="button" aria-pressed={group === value} onClick={() => onGroup(value)} className={`rounded-md border px-3 py-2 ${group === value ? 'border-slate-800 bg-slate-800 text-white' : 'border-stone-300 bg-white'}`}>{value ? 'Group' : 'Single'}</button>)}</div></fieldset>
    {group && <>
      <label className="block">Number of students<input required type="number" min="2" max="10000" step="1" value={count} onChange={event => onCount(event.target.value)} className={inputClass} /></label>
      <div ref={dropdown} className="relative" onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }} onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      }}>
        <label htmlFor={`${dropdownId}-trigger`} className="block">Covered students <span className="font-normal text-slate-500">· {selected.length} / {count || '—'} selected</span></label>
        <button ref={trigger} id={`${dropdownId}-trigger`} type="button" aria-expanded={open} aria-controls={`${dropdownId}-options`} onClick={() => { setOpen(value => !value); setSearch(''); }} className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-md border border-stone-300 bg-white p-2 text-left focus:border-lime-600 focus:outline-none focus:ring-1 focus:ring-lime-600">
          <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {selected.map(id => {
              const student = students.find(item => item.id === id);
              return <span key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-stone-100 py-1 pl-1 pr-2.5 text-xs font-normal text-slate-800">
                {student && <StudentAvatar student={student} />}
                <span className="truncate">{student ? `${student.firstName} ${student.lastName}` : id === payerId ? 'Payer' : `Student #${id}`}{id === payerId && student ? ' (payer)' : ''}</span>
              </span>;
            })}
            {!selected.length && <span className="px-1 text-sm font-normal text-slate-400">Select students…</span>}
          </span>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {open && <div id={`${dropdownId}-options`} className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-md border border-stone-200 bg-white shadow-lg">
          {loading ? <p role="status" className="p-3">Loading students…</p> : error ? <p role="alert" className="p-3">{error} <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : <>
            <div className="border-b border-stone-100 p-2"><label className="sr-only" htmlFor={`${dropdownId}-search`}>Find a student</label><input id={`${dropdownId}-search`} type="search" placeholder="Find a student…" value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-normal focus:border-lime-600 focus:outline-none focus:ring-1 focus:ring-lime-600" /></div>
            <div className="max-h-56 overflow-y-auto p-1" role="group" aria-label="Student options">{students.filter(student => `${student.firstName} ${student.lastName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(student => {
              const checked = selected.includes(student.id);
              const disabled = student.id === payerId || (!checked && selected.length >= Number(count));
              return <button key={student.id} type="button" aria-pressed={checked} aria-disabled={disabled} onClick={() => {
                if (!disabled) onSelected(checked ? selected.filter(id => id !== student.id) : [...selected, student.id]);
              }} className={`flex w-full items-center gap-2 rounded-md border-0 px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-600 ${checked ? 'bg-lime-100 text-lime-900' : 'bg-white hover:bg-stone-50'} ${disabled && !checked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                <StudentAvatar student={student} />
                <span className="min-w-0 break-words text-sm font-normal">{student.firstName} {student.lastName}{student.id === payerId ? ' (payer)' : ''}</span>
              </button>;
            })}
            {!students.some(student => `${student.firstName} ${student.lastName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className="px-3 py-2 font-normal text-slate-500">No students found.</p>}</div>
          </>}
        </div>}
      </div>
      <p className="text-xs font-normal text-slate-500">Includes the payer. Each selected student receives the full class allowance.</p>
      {selected.length !== Number(count) && <p className="text-xs text-amber-800">Select exactly {count || 'the configured number of'} students before saving.</p>}
    </>}
  </>;
}
