"use client";

import { useEffect, useRef } from 'react';
import type { TaskStudent } from '../lib/tasks';
import TaskStudentSelect from './task-student-select';

export default function TaskStudentsDialog({ students, selected, loading, error, onChange, onClose, kind = 'students' }: {
  students: TaskStudent[]; selected: number[]; loading: boolean; error: string;
onChange: (ids: number[]) => void; onClose: () => void; kind?: 'students' | 'courses' | 'administrators';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    element.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    return () => { element.close(); previous?.focus({ preventScroll: true }); };
  }, []);
  const button = 'min-h-11 rounded-md border border-white/15 px-3 py-2 text-sm font-medium hover:bg-white/10 focus-visible:outline-blue-400';
  return <dialog ref={dialog} aria-labelledby="task-students-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border border-white/10 bg-[#242528] p-5 font-sans text-sm text-stone-200 shadow-2xl backdrop:bg-slate-950/60">
    <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-4"><h2 id="task-students-title" className="text-lg font-semibold">Select {kind}</h2><button type="button" aria-label={`Close ${kind} selection`} className={button} onClick={onClose}>×</button></div>
    {loading && <p role="status">Loading {kind}…</p>}
    {error && <p role="alert" className="text-red-300">{error} Existing links are preserved.</p>}
    <TaskStudentSelect expanded dark kind={kind} students={students} selected={selected} onChange={onChange} />
    <p className="px-2 text-xs text-stone-400">Selections are saved with the task. To deselect a mention, remove it from the description first.</p>
  </dialog>;
}
