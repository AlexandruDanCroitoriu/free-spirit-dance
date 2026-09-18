"use client";

import { useEffect, useRef, useState } from 'react';
import { manualTaskFields, type BoardTask, type ManualTaskFields, type TaskBoard, type TaskEvent, type TaskMeeting } from '../lib/tasks';
import { taskRequest, TaskRequestError } from '../lib/tasks-client';
import TaskStudentsDialog from './task-students-dialog';
import TaskAssigneeSelect from './task-assignee-select';
import TaskDueDateSelect from './task-due-date-select';
import { descriptionLinks } from '../lib/task-description';
import TaskDescriptionEditor from './task-description-editor';
import type { Student } from './student-panel';

function fieldsFor(task: BoardTask | null, studentId: number | null): ManualTaskFields {
  return task ? { status: task.status, title: task.title, description: task.description, dueDate: task.dueDate, studentIds: task.students.map(student => student.id), courseIds: task.courses?.map(course => course.id) ?? [], eventIds: task.events?.map(event => event.id) ?? [], meetingIds: task.meetings?.map(meeting => meeting.id) ?? [], administratorEmails: task.administratorEmails ?? [], assignedTo: task.assignedTo ?? null } : { title: '', description: '', dueDate: null, studentIds: studentId === null ? [] : [studentId], courseIds: [], eventIds: [], meetingIds: [] };
}

export default function TaskPanel({ task, board, studentId, listId, onClose, onSaved }: {
  listId?: number | null; task: BoardTask | null; board: TaskBoard; studentId: number | null; onClose: () => void; onSaved: (message: string) => void | Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const reviewedUpdatedAt = useRef(task?.updatedAt);
  const [fields, setFields] = useState(() => fieldsFor(task, studentId));
  const [selectedList, setSelectedList] = useState<number | null>(task?.listId ?? listId ?? null);
  const [revision, setRevision] = useState(board.revision);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentError, setStudentError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<BoardTask | null>(null);
  const [missing, setMissing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [courses, setCourses] = useState<{ id: number; name: string }[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [meetings, setMeetings] = useState<TaskMeeting[]>([]);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventError, setEventError] = useState('');
  const [administrators, setAdministrators] = useState<{ email: string; name: string; picture: string | null }[]>([]);
  const [administratorsOpen, setAdministratorsOpen] = useState(false);
  const [administratorError, setAdministratorError] = useState('');
  const [administratorsLoading, setAdministratorsLoading] = useState(true);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [courseError, setCourseError] = useState('');
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [studentsOpen, setStudentsOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(task?.description ?? '');
  // Retain the exact request after a lost response; POST retries are idempotent.
  const pendingCreate = useRef<(ManualTaskFields & { revision: number; requestKey: string; listId?: number | null }) | null>(null);
  const pendingDuplicate = useRef<{ revision: number; requestKey: string } | null>(null);
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
    taskRequest<{ email: string; name: string; picture: string | null }[]>('/api/tasks/administrators').then(data => { if (!cancelled) setAdministrators(data); }).catch(reason => { if (!cancelled) setAdministratorError(reason instanceof Error ? reason.message : 'Could not load administrators.'); }).finally(() => { if (!cancelled) setAdministratorsLoading(false); });
    taskRequest<{ id: number; name: string }[]>('/api/courses').then(data => { if (!cancelled) setCourses(data); }).catch(reason => { if (!cancelled) setCourseError(reason instanceof Error ? reason.message : 'Could not load courses.'); }).finally(() => { if (!cancelled) setCoursesLoading(false); });
    taskRequest<{ events: TaskEvent[]; meetings: TaskMeeting[] }>('/api/tasks/events').then(data => { if (!cancelled) { setEvents(data.events); setMeetings(data.meetings); } }).catch(reason => { if (!cancelled) setEventError(reason instanceof Error ? reason.message : 'Could not load events and meetings.'); }).finally(() => { if (!cancelled) setEventsLoading(false); });
    taskRequest<Student[]>('/api/students').then(data => { if (!cancelled) setStudents(data); }).catch(reason => { if (!cancelled) setStudentError(reason instanceof Error ? reason.message : 'Could not load students.'); }).finally(() => { if (!cancelled) setStudentsLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!task || saving || conflict || missing) return;
    let cancelled = false;
    let refreshing = false;
    const refreshRevision = () => {
      if (cancelled || refreshing || busy.current || document.visibilityState !== 'visible') return;
      refreshing = true;
      void taskRequest<TaskBoard>('/api/tasks').then(current => {
        if (cancelled) return;
        const latestTask = current.tasks.find(item => item.key === task.key);
        if (!latestTask) {
          setMissing(true); setError('This task was deleted by another administrator. Your draft is still shown below.');
        } else if (latestTask.updatedAt !== reviewedUpdatedAt.current) {
          setLatest(latestTask); setConflict(true); setError('This task was updated by another administrator. Your draft has been kept.');
        } else {
          // A different card, list, or board changed. Use its current revision
          // so that it never blocks this untouched task from being saved.
          setRevision(current.revision);
        }
      }).catch(() => {}).finally(() => { refreshing = false; });
    };
    const timer = window.setInterval(refreshRevision, 5_000);
    document.addEventListener('visibilitychange', refreshRevision);
    window.addEventListener('focus', refreshRevision);
    window.addEventListener('pageshow', refreshRevision);
    return () => {
      cancelled = true; window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshRevision);
      window.removeEventListener('focus', refreshRevision);
      window.removeEventListener('pageshow', refreshRevision);
    };
  }, [task, saving, conflict, missing]);

  async function submit(remove = false) {
    if (busy.current || conflict || missing) return;
    busy.current = true; setSaving(true); setError('');
    try {
      if (remove && task) await taskRequest(`/api/tasks/${encodeURIComponent(task.key)}`, 'DELETE', { revision });
      else if (task) await taskRequest(`/api/tasks/${encodeURIComponent(task.key)}`, 'PATCH', { ...manualTaskFields({ ...fields, description: descriptionOpen ? descriptionDraft : fields.description }), listId: selectedList, revision });
      else {
        pendingCreate.current ??= { ...manualTaskFields({ ...fields, description: descriptionOpen ? descriptionDraft : fields.description }), revision, listId: selectedList, requestKey: crypto.randomUUID() };
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
      reviewedUpdatedAt.current = updated?.updatedAt;
      setError('Your draft has been kept. Review the latest saved values before saving again.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not refresh tasks.'); }
    finally { busy.current = false; setSaving(false); }
  }
  async function duplicate() {
    if (!task || busy.current || conflict || missing) return;
    busy.current = true; setSaving(true); setError('');
    try {
      pendingDuplicate.current ??= { revision, requestKey: crypto.randomUUID() };
      await taskRequest(`/api/tasks/${encodeURIComponent(task.key)}`, 'POST', pendingDuplicate.current);
      await onSaved('Task duplicated.');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not duplicate card.';
      setError(message);
      if (reason instanceof TaskRequestError && reason.status < 500) pendingDuplicate.current = null;
    } finally { busy.current = false; setSaving(false); }
  }
  const button = 'min-h-10 rounded-md border border-white/15 px-3 py-2 text-sm font-medium hover:bg-white/10 focus-visible:outline-blue-400 disabled:opacity-50';
  const mentions = descriptionLinks(descriptionOpen ? descriptionDraft : fields.description);
  const selectedStudents = [...new Set([...fields.studentIds, ...mentions.studentIds])];
  const selectedAdministrators = [...new Set([...(fields.administratorEmails ?? []), ...mentions.administratorEmails])];
  const administratorChoices = [...administrators];
  for (const email of [...selectedAdministrators, fields.assignedTo].filter((email): email is string => !!email)) if (!administratorChoices.some(admin => admin.email === email)) administratorChoices.push({ email, name: email, picture: null });
  const creator = task && administrators.find(admin => admin.email.toLowerCase() === task.createdBy.toLowerCase());
  const selectedCourses = [...new Set([...fields.courseIds, ...mentions.courseIds])];
  const selectedEvents = [...new Set([...(fields.eventIds ?? []), ...mentions.eventIds])];
  const selectedMeetings = [...new Set([...(fields.meetingIds ?? []), ...mentions.meetingIds])];
  const courseChoices = [...courses, ...(task?.courses ?? []).filter(course => !courses.some(item => item.id === course.id))].map(course => ({ ...course, picture: null }));
  const studentChoices = students.map(student => ({ id: student.id, name: `${student.firstName} ${student.lastName}`, picture: student.picture }));
  for (const id of fields.studentIds) if (!studentChoices.some(student => student.id === id)) studentChoices.push(task?.students.find(student => student.id === id) ?? { id, name: `Student #${id}`, picture: null });
  const eventChoices = [...events, ...(task?.events ?? []).filter(event => !events.some(item => item.id === event.id))];
  const meetingChoices = [...meetings, ...(task?.meetings ?? []).filter(meeting => !meetings.some(item => item.id === meeting.id))];
  const eventMeetingChoices = [...eventChoices.map(event => ({ id: event.id, name: `Event: ${event.name}`, picture: event.imagePath ?? null, value: `event:${event.id}` })), ...meetingChoices.map(meeting => ({ id: meeting.id, name: `Meeting: ${meeting.eventName} — ${meeting.name}`, picture: eventChoices.find(event => event.id === meeting.eventId)?.imagePath ?? null, value: `meeting:${meeting.id}` }))];
  const selectedEventMeetingChoices = eventMeetingChoices.flatMap((choice, index) => (choice.value.startsWith('event:') ? selectedEvents.includes(choice.id) : selectedMeetings.includes(choice.id)) ? [index + 1] : []);
  return <dialog ref={dialog} aria-labelledby="task-editor-title" onCancel={event => { event.preventDefault(); if (!busy.current) onClose(); }} className="fixed inset-0 m-auto box-border max-h-dvh w-full max-w-2xl overflow-y-auto rounded-xl border border-white/10 bg-[#242528] p-5 text-stone-200 shadow-2xl backdrop:bg-slate-950/60 sm:max-h-[90dvh] sm:p-7">
    <form className="space-y-4 font-sans text-sm" onSubmit={event => { event.preventDefault(); if (!deleting) void submit(); }}>
      <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
        <h2 id="task-editor-title" className="sr-only">{task ? 'Edit task' : 'Create task'}</h2>
        <input aria-label="Task name" required maxLength={200} disabled={saving || uncertain || missing} className="min-h-12 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-bold text-stone-100 hover:border-white/20 focus:border-blue-400 focus:outline-none" value={fields.title} onChange={event => setFields({ ...fields, title: event.target.value })} />
        <button type="button" className={button} disabled={saving} onClick={onClose} aria-label="Close task editor">×</button>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-400/30 bg-red-950/40 p-3 text-red-200">{error}{conflict && !missing && <button type="button" className={`${button} mt-2 block`} disabled={saving} onClick={() => void reviewLatest()}>Review latest board</button>}</div>}
      {latest && <details open className="rounded-lg border border-white/15 bg-[#292a2c] p-3 text-stone-200"><summary>Latest saved task</summary><dl className="space-y-1 break-words"><dt className="font-semibold">Title</dt><dd>{latest.title}</dd><dt className="font-semibold">Description</dt><dd className="min-w-0 break-words">{latest.description ? <TaskDescriptionEditor readOnly value={latest.description} /> : 'None'}</dd><dt className="font-semibold">Status</dt><dd>{latest.status === 'done' ? 'Done' : latest.status === 'blocked' ? 'Blocked' : 'In progress'}</dd><dt className="font-semibold">Due date / students</dt><dd>{latest.dueDate || 'No due date'} · {latest.students.map(student => student.name).join(', ') || 'No students'}</dd></dl><button type="button" className={button} disabled={saving} onClick={() => { setFields(fieldsFor(latest, null)); setDescriptionDraft(latest.description); setDescriptionOpen(false); setSelectedList(latest.listId); setLatest(null); setError(''); }}>Use latest saved values</button></details>}
      {uncertain && <p role="status">The save may have succeeded. Retry the same request to confirm it before creating another task.</p>}
      {studentsLoading && <p role="status" className="text-slate-500">Loading student choices…</p>}
      <fieldset disabled={saving || uncertain || missing} className="m-0 space-y-4 border-0 p-0">
        <button type="button" className={button} aria-haspopup="dialog" onClick={() => setStudentsOpen(true)}>Students{selectedStudents.length ? ` (${selectedStudents.length})` : ''}</button>
        <button type="button" className={button} aria-haspopup="dialog" onClick={() => setCoursesOpen(true)}>Courses{selectedCourses.length ? ` (${selectedCourses.length})` : ''}</button>
        <button type="button" className={button} aria-haspopup="dialog" onClick={() => setAdministratorsOpen(true)}>Administrators{selectedAdministrators.length ? ` (${selectedAdministrators.length})` : ''}</button>
        <button type="button" className={button} aria-haspopup="dialog" onClick={() => setEventsOpen(true)}>Events & meetings{selectedEvents.length + selectedMeetings.length ? ` (${selectedEvents.length + selectedMeetings.length})` : ''}</button>
        <div className={task ? 'grid grid-cols-1 items-start gap-3 sm:grid-cols-2' : ''}><div><span className="block text-stone-300">Status</span><div role="group" aria-label="Task status" className="mt-2 inline-flex gap-1 rounded-lg border border-white/20 bg-[#292a2c] p-1">
          {(['in_progress', 'blocked', 'done'] as const).map(status => <button key={status} type="button" aria-pressed={(fields.status ?? 'in_progress') === status} className={`min-h-11 rounded-md px-4 font-semibold transition-colors ${(fields.status ?? 'in_progress') === status ? 'bg-blue-400 text-slate-950' : 'text-stone-300 hover:bg-white/10'}`} onClick={() => setFields(previous => ({ ...previous, status }))}>{status === 'done' ? 'Done' : status === 'blocked' ? 'Blocked' : 'In progress'}</button>)}
        </div></div>
        {task && <div><span className="block text-stone-300">Created by</span><div className="mt-1 flex min-h-11 items-center gap-2 text-stone-100">
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-purple-200 text-xs font-semibold text-purple-950">{creator?.picture && /^\/(?!\/)/.test(creator.picture) ? <img src={creator.picture} alt="" className="h-full w-full object-cover" /> : (creator?.name ?? task.createdBy).split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span>
          <span className="min-w-0 break-words">{creator?.name ?? task.createdBy}</span>
        </div></div>}</div>
        <div className="grid grid-cols-2 items-start gap-3">
          <TaskAssigneeSelect administrators={administratorChoices} value={fields.assignedTo ?? null} disabled={saving || uncertain || missing} onChange={assignedTo => setFields(previous => ({ ...previous, assignedTo }))} />
          <TaskDueDateSelect value={fields.dueDate} disabled={saving || uncertain || missing} onChange={dueDate => setFields(previous => ({ ...previous, dueDate }))} />
        </div>
        {administratorError && <p role="alert" className="text-red-300">{administratorError}</p>}
        {eventError && <p role="alert" className="text-red-300">{eventError}</p>}
        <section className="py-4" aria-labelledby="task-description-label">
          <h3 id="task-description-label" className="mb-4 flex items-center gap-3 font-semibold"><svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><path d="M3 5h18M3 12h18M3 19h10" /></svg>Description</h3>
          {descriptionOpen ? <><TaskDescriptionEditor administrators={administratorChoices} courses={courseChoices} students={studentChoices} events={eventChoices} meetings={meetingChoices} value={descriptionDraft} onChange={setDescriptionDraft} disabled={saving || uncertain || missing} /><div className="mt-2 flex gap-2"><button type="button" disabled={descriptionDraft.length > 10000} className={`${button} bg-blue-400 text-slate-950`} onClick={() => { setFields({ ...fields, description: descriptionDraft }); setDescriptionOpen(false); }}>Save description</button><button type="button" className={button} onClick={() => setDescriptionOpen(false)}>Cancel</button></div><p className="text-xs text-stone-400">Changes are saved with Save task.</p></> : <div role="button" tabIndex={saving || uncertain || missing ? -1 : 0} aria-label="Edit description" onClick={() => { if (saving || uncertain || missing) return; setDescriptionDraft(fields.description); setDescriptionOpen(true); }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); event.currentTarget.click(); } }} className="min-h-20 w-full cursor-text break-words rounded-md border border-white/30 px-3 py-3 text-left text-stone-300 hover:bg-white/5">{fields.description ? <TaskDescriptionEditor administrators={administratorChoices} readOnly value={fields.description} /> : 'Add a more detailed description…'}</div>}
        </section>
      </fieldset>
      {deleting ? <div className="rounded-lg border border-red-400/40 bg-red-950/45 p-3 text-red-100"><p className="m-0">Permanently delete this task? This also removes its student relationship.</p><div className="mt-3 flex flex-wrap gap-2"><button autoFocus type="button" className={`${button} bg-white/10 text-stone-100 hover:bg-white/15`} disabled={saving} onClick={() => setDeleting(false)}>Keep task</button><button type="button" className={`${button} bg-red-600 text-white hover:bg-red-500`} disabled={saving || conflict || missing} onClick={() => void submit(true)}>Confirm delete</button></div></div> : <div className="flex flex-wrap justify-end gap-2">{task && <button type="button" className={`${button} mr-auto`} disabled={saving || conflict || missing} onClick={() => void duplicate()}>Duplicate card</button>}{task?.canDelete && <button type="button" className={`${button} text-red-700`} disabled={saving || missing} onClick={() => setDeleting(true)}>Delete task</button>}<button type="button" className={button} disabled={saving} onClick={onClose}>Cancel</button><button className={`${button} bg-slate-800 text-white`} disabled={saving || conflict || missing || !fields.title.trim()}>{saving ? 'Saving…' : uncertain ? 'Retry save' : 'Save task'}</button></div>}
    </form>
    {studentsOpen && <TaskStudentsDialog students={studentChoices} selected={selectedStudents} loading={studentsLoading} error={studentError} onChange={studentIds => setFields(previous => ({ ...previous, studentIds }))} onClose={() => setStudentsOpen(false)} />}
    {administratorsOpen && <TaskStudentsDialog kind="administrators" students={administratorChoices.map((admin, index) => ({ id: index + 1, name: admin.name, picture: admin.picture }))} selected={administratorChoices.flatMap((admin, index) => selectedAdministrators.includes(admin.email) ? [index + 1] : [])} loading={administratorsLoading} error={administratorError} onChange={ids => setFields(previous => ({ ...previous, administratorEmails: ids.map(id => administratorChoices[id - 1].email) }))} onClose={() => setAdministratorsOpen(false)} />}
    {coursesOpen && <TaskStudentsDialog kind="courses" students={courseChoices} selected={selectedCourses} loading={coursesLoading} error={courseError} onChange={courseIds => setFields(previous => ({ ...previous, courseIds }))} onClose={() => setCoursesOpen(false)} />}
    {eventsOpen && <TaskStudentsDialog kind="events and meetings" students={eventMeetingChoices} selected={selectedEventMeetingChoices} loading={eventsLoading} error={eventError} onChange={ids => setFields(previous => ({ ...previous, eventIds: ids.flatMap(id => { const choice = eventMeetingChoices[id - 1]; return choice?.value.startsWith('event:') ? [choice.id] : []; }), meetingIds: ids.flatMap(id => { const choice = eventMeetingChoices[id - 1]; return choice?.value.startsWith('meeting:') ? [choice.id] : []; }) }))} onClose={() => setEventsOpen(false)} />}
  </dialog>;
}
