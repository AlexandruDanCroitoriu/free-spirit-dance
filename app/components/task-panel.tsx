"use client";

import { useEffect, useRef, useState } from 'react';
import { manualTaskFields, type BoardTask, type ManualTaskFields, type TaskBoard } from '../lib/tasks';
import { taskRequest, TaskRequestError } from '../lib/tasks-client';
import type { Student } from './student-panel';

function fieldsFor(task: BoardTask | null, studentId: number | null): ManualTaskFields {
  return task ? { title: task.title, description: task.description, dueDate: task.dueDate, status: task.status, studentId: task.student?.id ?? null } : { title: '', description: '', dueDate: null, status: 'todo', studentId };
}

export default function TaskPanel({ task, board, studentId, onClose, onSaved }: {
  task: BoardTask | null; board: TaskBoard; studentId: number | null; onClose: () => void; onSaved: (message: string) => void | Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [fields, setFields] = useState(() => fieldsFor(task, studentId));
  const [revision, setRevision] = useState(board.revision);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentError, setStudentError] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<BoardTask | null>(null);
  const [missing, setMissing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  // Retain the exact request after a lost response; POST retries are idempotent.
  const pendingCreate = useRef<(ManualTaskFields & { revision: number; requestKey: string }) | null>(null);
  useEffect(() => {
    const element = dialog.current!;
    const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; element.showModal(); element.querySelector('input')?.focus();
    return () => {
      element.close(); document.body.style.overflow = overflow;
      window.requestAnimationFrame(() => {
        if (focus?.isConnected && !focus.matches(':disabled')) focus.focus();
        else document.getElementById('task-board-summary')?.focus();
      });
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    taskRequest<Student[]>('/api/students').then(data => { if (!cancelled) setStudents(data); }).catch(reason => { if (!cancelled) setStudentError(reason instanceof Error ? reason.message : 'Could not load students.'); }).finally(() => { if (!cancelled) setStudentsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function submit(remove = false) {
    if (busy.current || conflict || missing) return;
    busy.current = true; setSaving(true); setError('');
    try {
      if (remove && task) await taskRequest(`/api/tasks/${encodeURIComponent(task.key)}`, 'DELETE', { revision });
      else if (task) await taskRequest(`/api/tasks/${encodeURIComponent(task.key)}`, 'PATCH', { ...manualTaskFields(fields), revision });
      else {
        pendingCreate.current ??= { ...manualTaskFields(fields), revision, requestKey: crypto.randomUUID() };
        await taskRequest('/api/tasks', 'POST', pendingCreate.current);
      }
      await onSaved(remove ? 'Task deleted.' : task ? 'Task updated.' : 'Task created.');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not save task.';
      setError(message);
      if (reason instanceof TaskRequestError) {
        setConflict(reason.status === 409);
        setMissing(reason.status === 404);
        // A server error may have happened after commit. Keep the retry key.
        if (reason.status < 500) { pendingCreate.current = null; setUncertain(false); }
        else if (pendingCreate.current) setUncertain(true);
      } else if (pendingCreate.current) setUncertain(true);
    } finally { busy.current = false; setSaving(false); }
  }
  async function reviewLatest() {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      const current = await taskRequest<TaskBoard>('/api/tasks');
      const updated = task ? current.tasks.find(item => item.key === task.key) : null;
      if (task && !updated) { setMissing(true); setError('This task was deleted. Your draft is still shown below.'); return; }
      setLatest(updated ?? null); setRevision(current.revision); setConflict(false);
      setError('Your draft has been kept. Review the latest saved values before saving again.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not refresh tasks.'); }
    finally { busy.current = false; setSaving(false); }
  }
  const input = 'mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-normal disabled:bg-stone-100';
  const button = 'min-h-11 rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold disabled:opacity-50';
  const chosen = students.find(student => student.id === fields.studentId);
  const choices = students.filter(student => student.id === fields.studentId || `${student.firstName} ${student.lastName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <dialog ref={dialog} aria-labelledby="task-editor-title" onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }} className="fixed inset-0 m-auto box-border max-h-dvh w-full max-w-xl overflow-y-auto rounded-xl border border-stone-200 bg-white p-5 text-slate-800 shadow-2xl backdrop:bg-slate-950/60 sm:max-h-[90dvh]">
    <form className="space-y-4 font-sans text-sm" onSubmit={event => { event.preventDefault(); if (!deleting) void submit(); }}>
      <div className="flex items-center justify-between gap-3"><h2 id="task-editor-title" className="m-0 font-serif text-xl font-normal">{task ? 'Edit task' : 'Create task'}</h2><button type="button" className={button} disabled={saving} onClick={onClose} aria-label="Close task editor">×</button></div>
      {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">{error}{conflict && !missing && <button type="button" className={`${button} mt-2 block`} disabled={saving} onClick={() => void reviewLatest()}>Review latest board</button>}</div>}
      {latest && <details open className="rounded-lg bg-stone-100 p-3"><summary>Latest saved task</summary><dl className="space-y-1 break-words"><dt className="font-semibold">Title</dt><dd>{latest.title}</dd><dt className="font-semibold">Description</dt><dd className="whitespace-pre-wrap">{latest.description || 'None'}</dd><dt className="font-semibold">Due date / status / student</dt><dd>{latest.dueDate || 'No due date'} · {board.columns.find(column => column.status === latest.status)?.title} · {latest.student?.name || 'No student'}</dd></dl><button type="button" className={button} disabled={saving} onClick={() => { setFields(fieldsFor(latest, null)); setLatest(null); setError(''); }}>Use latest saved values</button></details>}
      {uncertain && <p role="status">The save may have succeeded. Retry the same request to confirm it before creating another task.</p>}
      {studentsLoading && <p role="status" className="text-slate-500">Loading student choices…</p>}
      <fieldset disabled={saving || uncertain || missing} className="m-0 space-y-4 border-0 p-0">
        <label className="block font-semibold">Title<input autoFocus required maxLength={200} className={input} value={fields.title} onChange={event => setFields({ ...fields, title: event.target.value })} /></label>
        <label className="block font-semibold">Description (optional)<textarea rows={4} maxLength={10000} className={input} value={fields.description} onChange={event => setFields({ ...fields, description: event.target.value })} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block font-semibold">Due date (optional)<input type="date" min="0001-01-01" max="9999-12-31" className={input} value={fields.dueDate ?? ''} onChange={event => setFields({ ...fields, dueDate: event.target.value || null })} /></label><label className="block font-semibold">Status<select className={input} value={fields.status} onChange={event => setFields({ ...fields, status: event.target.value as ManualTaskFields['status'] })}>{board.columns.map(column => <option key={column.status} value={column.status}>{column.title}</option>)}</select></label></div>
        <div><label className="block font-semibold">Find student<input type="search" className={input} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name" /></label><label className="mt-2 block font-semibold">Linked student (optional)<select className={input} value={fields.studentId ?? ''} onChange={event => setFields({ ...fields, studentId: event.target.value ? Number(event.target.value) : null })}><option value="">No student</option>{fields.studentId && !chosen && <option value={fields.studentId}>{task?.student?.name ?? `Student #${fields.studentId}`}</option>}{choices.map(student => <option key={student.id} value={student.id}>{student.firstName} {student.lastName}{student.active ? '' : ' (inactive)'} · #{student.id}</option>)}</select></label>{studentError && <p role="alert" className="text-red-700">{studentError} You can keep or remove the current link.</p>}<p className="text-xs text-slate-500">Choose “No student” to remove the relationship. Linked students cannot be deleted.</p></div>
      </fieldset>
      {deleting ? <div className="rounded-lg border border-red-200 bg-red-50 p-3"><p>Permanently delete this task? This also removes its student relationship.</p><div className="flex flex-wrap gap-2"><button autoFocus type="button" className={button} disabled={saving} onClick={() => setDeleting(false)}>Keep task</button><button type="button" className={`${button} bg-red-700 text-white`} disabled={saving || conflict || missing} onClick={() => void submit(true)}>Confirm delete</button></div></div> : <div className="flex flex-wrap justify-end gap-2">{task?.canDelete && <button type="button" className={`${button} mr-auto text-red-700`} disabled={saving || missing} onClick={() => setDeleting(true)}>Delete task</button>}<button type="button" className={button} disabled={saving} onClick={onClose}>Cancel</button><button className={`${button} bg-slate-800 text-white`} disabled={saving || conflict || missing || !fields.title.trim()}>{saving ? 'Saving…' : uncertain ? 'Retry save' : 'Save task'}</button></div>}
    </form>
  </dialog>;
}
