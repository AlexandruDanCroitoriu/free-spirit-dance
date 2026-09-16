"use client";

import { useState } from 'react';
import type { TaskStudent } from '../lib/tasks';

export default function TaskStudentSelect({ students, selected, onChange, expanded = false, dark = false, kind = 'students' }: {
students: TaskStudent[]; selected: number[]; onChange: (ids: number[]) => void; expanded?: boolean; dark?: boolean; kind?: 'students' | 'courses' | 'administrators';
}) {
  const [search, setSearch] = useState('');
  const choices = students.filter(student => student.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const content = <div className="space-y-2 p-2">
      <label className="block"><span className="sr-only">Search {kind}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={`Search ${kind}…`} className={`min-h-11 w-full rounded-lg border px-3 focus:outline-blue-400 ${dark ? 'border-white/20 bg-[#292a2c] text-stone-100 placeholder:text-stone-400' : 'border-stone-300 bg-white'}`} /></label>
      <div role="group" aria-label={`${kind} choices`} className="task-scrollbar max-h-56 overflow-y-auto">
        {choices.map(student => <label key={student.id} className={`relative mb-1 flex min-h-11 cursor-pointer items-center gap-2 rounded-md p-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-blue-400 ${selected.includes(student.id) ? (dark ? 'bg-green-800 text-green-50 hover:bg-green-700' : 'bg-green-100 text-green-950 hover:bg-green-200') : dark ? 'hover:bg-white/10' : 'hover:bg-stone-50'}`}>
          <input type="checkbox" checked={selected.includes(student.id)} onChange={event => onChange(event.target.checked ? [...selected, student.id] : selected.filter(id => id !== student.id))} className="sr-only" />
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 text-xs text-slate-900">{student.picture ? <img src={student.picture} alt="" loading="lazy" className="h-full w-full object-cover" /> : student.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('')}</span>
          <span className="min-w-0 break-words">{student.name}</span>
        </label>)}
        {!choices.length && <p role="status" className="px-2 text-slate-500">No matching {kind}.</p>}
      </div>
    </div>;
  if (expanded) return content;
  return <details className="rounded-lg border border-stone-300 bg-white" onKeyDown={event => {
    if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
  }}>
    <summary className="min-h-11 cursor-pointer px-3 py-3 font-semibold">Linked students{selected.length ? ` (${selected.length})` : ' (optional)'}</summary>
    {content}
  </details>;
}
