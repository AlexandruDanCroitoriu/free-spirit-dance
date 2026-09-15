"use client";

import { useEffect, useRef, useState } from "react";
import {
  type CalendarClass,
  type ClassRoster,
  type ClassStudent,
} from "../lib/class-attendance";
import { formatLogDate } from "../lib/student-activity";
import StudentPanel, { type Student } from "./student-panel";
import TimeSelector from "./time-selector";
import { confirmAction } from "../lib/confirmation";
const button =
  "rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold disabled:opacity-50";
async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new Error(
      data &&
        typeof data === "object" &&
        "error" in data &&
        typeof data.error === "string"
        ? data.error
        : "Could not complete the request.",
    );
  return data as T;
}
export default function ClassAttendancePanel({
  slot: initialSlot,
  courseName,
  onClose,
}: {
  slot: CalendarClass;
  courseName: string;
  onClose: () => void;
}) {
  const [slot, setSlot] = useState(initialSlot);
  const [tab, setTab] = useState<"attendance" | "details">("attendance");
  const [details, setDetails] = useState({ courseId: initialSlot.courseId, classDate: initialSlot.classDate, startTime: initialSlot.startTime, endTime: "", rent: "0", rentPaid: false });
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [data, setData] = useState<ClassRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [complimentary, setComplimentary] = useState<number[]>([]);
  const [complimentaryChanges, setComplimentaryChanges] = useState<Record<number, boolean>>({});
  const changeCount = selected.length + Object.keys(complimentaryChanges).length;
  const [complimentaryReason, setComplimentaryReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [studentPanelId, setStudentPanelId] = useState<number | null>(null);
  const detailsChanged = Boolean(data && (details.courseId !== slot.courseId || details.classDate !== slot.classDate || details.startTime !== slot.startTime || details.endTime !== (data.endTime ?? "") || details.rent !== String(data.rentCostMinor / 100) || details.rentPaid !== data.rentPaid));
  const editable = data?.canEdit === true;
  const query = new URLSearchParams({
    courseId: String(slot.courseId),
    classDate: slot.classDate,
    startTime: slot.startTime,
  }).toString();
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo(0, window.scrollY)));
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/class-attendance?${query}`, { signal: controller.signal })
      .then(readResponse<ClassRoster>)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setDetails({ courseId: slot.courseId, classDate: slot.classDate, startTime: slot.startTime, endTime: result.endTime ?? "", rent: String(result.rentCostMinor / 100), rentPaid: result.rentPaid });
          setSelected([]); setComplimentary([]); setComplimentaryChanges({}); setComplimentaryReason("");
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load students.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, retry]);
  function close() {
    if (saving.current) return;
    if (changeCount > 0 || detailsChanged) { void confirmAction("Discard changes?", "Close without saving attendance or class details?", "Discard changes", true).then((confirmed) => { if (confirmed) onClose(); }); return; }
    onClose();
  }
  async function reload() {
    if (saving.current || loading) return;
    if ((changeCount > 0 || detailsChanged) && !await confirmAction("Discard changes?", "Reload the class and discard unsaved attendance and details?", "Discard changes", true)) return;
    setRetry(value => value + 1);
  }
  function toggle(id: number) {
    setNotice("");
    setComplimentary((ids) => ids.filter((value) => value !== id));
    setComplimentaryChanges((current) => { const next = { ...current }; delete next[id]; return next; });
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  }
  async function changeCancellation() {
    if (saving.current || !data || changeCount > 0 || detailsChanged) return;
    if (!data.cancelled && !await confirmAction("Cancel class occurrence?", "Cancel this class occurrence?", "Cancel class", true)) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await readResponse(await fetch("/api/class-attendance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...slot, cancelled: !data.cancelled }) }));
      setSelected([]); setComplimentary([]); setComplimentaryChanges({}); setComplimentaryReason(""); setRetry((value) => value + 1);
      window.dispatchEvent(new Event("calendar-updated"));
      setNotice(data.cancelled ? "Class restored." : "Class cancelled.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update class."); }
    finally { saving.current = false; setBusy(false); }
  }
  async function removeClass() {
    if (saving.current || !data?.canRemoveClass || changeCount > 0 || detailsChanged) return;
    if (!await confirmAction("Remove class?", "Remove this class occurrence? It has no recorded attendance.", "Remove class", true)) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await readResponse(await fetch(`/api/class-attendance?${query}`, { method: "DELETE" }));
      window.dispatchEvent(new Event("calendar-updated"));
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove class."); }
    finally { saving.current = false; setBusy(false); }
  }
  async function saveDetails() {
    if (saving.current || !data?.canManageClass || !detailsChanged || changeCount > 0) return;
    if (!details.endTime || details.endTime <= details.startTime || !/^\d+(?:\.\d{1,2})?$/.test(details.rent)) {
      setError("Enter an end time after the start time and a valid rent amount."); return;
    }
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await readResponse<CalendarClass & { endTime: string; rentCostMinor: number; rentPaid: boolean }>(await fetch("/api/class-attendance", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...slot, details: { courseId: details.courseId, classDate: details.classDate, startTime: details.startTime, endTime: details.endTime, rentCostMinor: Math.round(Number(details.rent) * 100), rentPaid: details.rentPaid } }),
      }));
      setData(current => current ? { ...current, endTime: result.endTime, rentCostMinor: result.rentCostMinor, rentPaid: result.rentPaid } : current);
      setDetails({ courseId: result.courseId, classDate: result.classDate, startTime: result.startTime, endTime: result.endTime, rent: String(result.rentCostMinor / 100), rentPaid: result.rentPaid });
      setSlot({ courseId: result.courseId, classDate: result.classDate, startTime: result.startTime });
      window.dispatchEvent(new Event("calendar-updated"));
      window.dispatchEvent(new Event("student-activity-updated"));
      setNotice("Class details saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save class details."); }
    finally { saving.current = false; setBusy(false); }
  }
  async function submit() {
    if (saving.current || !changeCount || !editable) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const ids = selected.filter((id) => !data?.students.find((s) => s.id === id)?.attended);
    const removedIds = selected.filter((id) => data?.students.find((s) => s.id === id)?.attended);
    try {
      const result = await readResponse<{ recorded: number; removed: number }>(
        await fetch("/api/class-attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...slot, studentIds: ids, removeStudentIds: removedIds, complimentaryStudentIds: complimentary.filter((id) => ids.includes(id)), complimentaryReason, complimentaryChanges: Object.entries(complimentaryChanges).map(([studentId, complimentary]) => ({ studentId: Number(studentId), complimentary })) }),
        }),
      );
      setData((current) =>
        current
          ? {
              ...current,
              students: current.students.map((student) =>
                ids.includes(student.id)
                  ? { ...student, attended: 1, complimentary: complimentary.includes(student.id) ? 1 : 0 }
                  : removedIds.includes(student.id) ? { ...student, attended: 0, complimentary: 0 } : student.id in complimentaryChanges ? { ...student, complimentary: complimentaryChanges[student.id] ? 1 : 0 } : student,
              ),
            }
          : current,
      );
      setSelected([]); setComplimentary([]); setComplimentaryChanges({}); setComplimentaryReason("");
      window.dispatchEvent(new Event("student-activity-updated"));
      setNotice(`Attendance saved: ${result.recorded} added, ${result.removed} removed; complimentary changes saved.`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save attendance. Please retry.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const recorded = data?.students.filter((s) => s.attended) ?? [];
  const assigned = data?.students.filter((s) => s.active && s.assigned && !s.attended) ?? [];
  const others = data?.students.filter((s) => !s.assigned && !s.attended) ?? [];
  function card(student: ClassStudent) {
    return (
      <AttendanceStudentCard
        key={student.id}
        student={student}
        selected={selected.includes(student.id)}
        disabled={busy || loading || !editable}
        onToggle={() => toggle(student.id)}
        onOpenStudent={() => setStudentPanelId(student.id)}
        complimentary={student.attended ? complimentaryChanges[student.id] ?? student.complimentary === 1 : complimentary.includes(student.id)}
        onComplimentaryToggle={() => {
          if (student.attended) setComplimentaryChanges((current) => {
            const next = { ...current };
            const value = !(current[student.id] ?? student.complimentary === 1);
            if (value === (student.complimentary === 1)) delete next[student.id]; else next[student.id] = value;
            return next;
          });
          else setComplimentary((ids) => ids.includes(student.id) ? ids.filter((id) => id !== student.id) : [...ids, student.id]);
        }}
      />
    );
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="class-attendance-title"
      aria-modal="true"
      className="fixed inset-0 m-0 box-border h-dvh max-h-none w-auto max-w-none overflow-y-auto border-0 bg-stone-50 p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60 md:inset-y-0 md:left-auto md:w-full md:max-w-2xl"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-200 bg-white p-5">
        <div>
          <h2 id="class-attendance-title" className="m-0 text-xl font-normal">
            {data?.courseName ?? courseName}
          </h2>
          <p className="mb-0 mt-2 font-sans text-sm text-slate-500">
            {formatLogDate(slot.classDate)} · {slot.startTime}
            {data?.endTime ? `–${data.endTime}` : ""}
          </p>
        </div>
        <button
          autoFocus
          aria-label="Close class attendance panel"
          type="button"
          className={button}
          disabled={busy}
          onClick={close}
        >
          ×
        </button>
      </header>
      <div role="tablist" aria-label="Class panel" className="flex gap-6 border-b border-stone-200 bg-white px-5">
        {(["attendance", "details"] as const).map(value => <button key={value} type="button" role="tab" id={`class-${value}-tab`} aria-controls={`class-${value}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "attendance" : event.key === "End" ? "details" : tab === "attendance" ? "details" : "attendance";
          setTab(next); document.getElementById(`class-${next}-tab`)?.focus();
        }} className={`border-b-2 py-3 font-sans text-sm font-semibold ${tab === value ? "border-lime-700 text-lime-800" : "border-transparent text-slate-500"}`}>{value === "attendance" ? "Attendance" : "Class details"}</button>)}
      </div>
      <div className="space-y-5 p-5">
        {data?.cancelled && <p role="status" className="rounded-lg bg-red-50 p-3 font-sans text-sm text-red-700">This class is cancelled. Attendance cannot be added.</p>}
        {error && (
          <div role="alert" className="font-sans text-sm text-red-700">
            {error}{" "}
            <button
              type="button"
              className={button}
              disabled={busy || loading}
              onClick={() => void reload()}
            >
              Reload class
            </button>
          </div>
        )}
        {changeCount > 500 && (
          <p role="alert" className="font-sans text-sm text-red-700">
            Select up to 500 students per submission.
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-lg bg-green-50 p-3 font-sans text-sm text-green-800"
          >
            {notice}
          </p>
        )}
        {loading && (
          <p role="status" className="font-sans text-sm text-slate-500">
            Loading students…
          </p>
        )}
        {tab === "details" && <section role="tabpanel" id="class-details-panel" aria-labelledby="class-details-tab" className="space-y-5">
          {data && <form onSubmit={event => { event.preventDefault(); void saveDetails(); }} className="space-y-4">
            <p className="font-sans text-sm text-slate-500">Changes apply to this class only. Recorded attendance follows any date or start-time change.</p>
            <fieldset disabled={busy || loading || !data.canManageClass} className="space-y-4 font-sans text-sm">
              <label className="block">Course<select required value={details.courseId} onChange={event => setDetails(current => ({ ...current, courseId: Number(event.target.value) }))} className="mt-2 w-full rounded-md border border-stone-300 bg-white p-2">{data.courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
              <label className="block">Date<input required type="date" min="1900-01-01" max="9999-12-31" value={details.classDate} onChange={event => setDetails(current => ({ ...current, classDate: event.target.value }))} className="mt-2 w-full rounded-md border border-stone-300 bg-white p-2" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <TimeSelector label="Start time (Bucharest)" value={details.startTime} onChange={startTime => setDetails(current => ({ ...current, startTime }))} />
                <TimeSelector label="End time (Bucharest)" value={details.endTime || details.startTime} onChange={endTime => setDetails(current => ({ ...current, endTime }))} />
              </div>
              {details.endTime && details.endTime <= details.startTime && <p role="alert" className="text-red-700">End time must be after start time.</p>}
              <label className="block">Rent cost (RON)<input required type="number" min="0" max="999999.99" step="0.01" value={details.rent} onChange={event => setDetails(current => ({ ...current, rent: event.target.value }))} className="mt-2 w-full rounded-md border border-stone-300 bg-white p-2" /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={details.rentPaid} onChange={event => setDetails(current => ({ ...current, rentPaid: event.target.checked }))} className="h-4 w-4 accent-lime-700" />Rent money given</label>
            </fieldset>
            {changeCount > 0 && <p className="font-sans text-sm text-slate-500">Submit your pending attendance changes before saving class details.</p>}
            <button type="submit" disabled={busy || loading || !data.canManageClass || !detailsChanged || changeCount > 0 || !details.endTime || details.endTime <= details.startTime} className="rounded-md bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Save class details"}</button>
          </form>}
        {data?.canManageClass && <div>
          <button type="button" className={button + " text-red-700"} disabled={busy || loading || changeCount > 0 || detailsChanged || (!data.cancelled && data.students.some((student) => student.attended))} onClick={() => void changeCancellation()}>{data.cancelled ? "Restore class" : "Cancel class"}</button>
          {data.canRemoveClass && <button type="button" className={button + " ml-2 text-red-700"} disabled={busy || loading || changeCount > 0 || detailsChanged} onClick={() => void removeClass()}>Remove class</button>}
          {!data.cancelled && data.students.some((student) => student.attended) && <p className="font-sans text-xs text-slate-500">Remove recorded attendance before cancelling this class.</p>}
        </div>}
          {detailsChanged && <p className="font-sans text-xs text-slate-500">Save class details before cancelling or restoring this class.</p>}
        </section>}
        {tab === "attendance" && <section role="tabpanel" id="class-attendance-panel" aria-labelledby="class-attendance-tab" className="space-y-5">
        {data && (
          <>
            {!!recorded.length && (
              <section aria-labelledby="selected-students-title">
                <h3
                  id="selected-students-title"
                  className="mb-3 text-lg font-normal"
                >
                  Selected students ({recorded.length})
                </h3>
                <div className="space-y-2">{recorded.map(card)}</div>
              </section>
            )}
            <section aria-labelledby="assigned-students-title">
              <h3
                id="assigned-students-title"
                className="mb-3 text-lg font-normal"
              >
                Assigned students ({assigned.length})
              </h3>
              <div className="space-y-2">{assigned.map(card)}</div>
              {!assigned.length && (
                <p className="font-sans text-sm text-slate-500">
                  No students are assigned to this course yet.
                </p>
              )}
            </section>
            <section aria-labelledby="other-students-title">
              <h3
                id="other-students-title"
                className="mb-3 text-lg font-normal"
              >
                Other students ({others.length})
              </h3>
              <div className="space-y-2">{others.map(card)}</div>
              {!others.length && (
                <p className="font-sans text-sm text-slate-500">
                  No other students.
                </p>
              )}
            </section>
          </>
        )}
        </section>}
      </div>
      {tab === "attendance" && <>
      {(complimentary.length > 0 || Object.values(complimentaryChanges).some(Boolean)) && <label className="block px-5 pb-4 font-sans text-xs text-slate-600">Complimentary reason (optional, applies to selected complimentary students)<input maxLength={500} disabled={busy} value={complimentaryReason} onChange={(event) => setComplimentaryReason(event.target.value)} className="mt-2 w-full rounded-md border border-stone-300 p-2 text-sm" /></label>}
      <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-stone-200 bg-white p-5">
        <p className="m-0 font-sans text-xs text-slate-500">
          {changeCount} changes ·{" "}
          {data?.students.filter((s) => s.attended).length ?? 0} recorded
        </p>
        <button
          type="button"
          disabled={
            busy ||
            loading ||
            !data ||
            !changeCount ||
            changeCount > 500 ||
            !editable
          }
          onClick={() => void submit()}
          className="rounded-md bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Submit attendance"}
        </button>
      </footer>
      </>}
      {studentPanelId !== null && <StudentPanel id={studentPanelId} onClose={() => setStudentPanelId(null)} onUpdate={(updated: Student) => setData((current) => current ? { ...current, students: current.students.map((student) => student.id === updated.id ? { ...student, firstName: updated.firstName, lastName: updated.lastName, picture: updated.picture, active: updated.active ? 1 : 0 } : student) } : current)} onDelete={(id) => { setData((current) => current ? { ...current, students: current.students.filter((student) => student.id !== id) } : current); setStudentPanelId(null); }} />}
    </dialog>
  );
}
export function AttendanceStudentCard({
  student,
  selected,
  disabled,
  onToggle,
  onOpenStudent,
  complimentary = false,
  onComplimentaryToggle,
}: {
  student: ClassStudent;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpenStudent?: () => void;
  complimentary?: boolean;
  onComplimentaryToggle?: () => void;
}) {
  const green = Boolean(student.attended) !== selected;
  return (
    <div className={`flex items-center gap-2 overflow-hidden rounded-xl border p-3 ${green ? "border-green-500 bg-green-50 text-green-900" : "border-stone-200 bg-white hover:border-green-400"}`}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 font-sans font-bold text-slate-800">
        {student.picture ? (
          <img
            alt=""
            src={student.picture}
            className="h-full w-full object-cover"
          />
        ) : (
          `${student.firstName[0] ?? ""}${student.lastName[0] ?? ""}`
        )}
      </span>
      <button
        type="button"
        onClick={onOpenStudent}
        className="min-w-0 flex-1 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lime-600"
        aria-label={`Open ${student.firstName} ${student.lastName}`}
      >
        <span className="min-w-0">
        <span className="block truncate font-sans text-sm font-semibold">
          {student.firstName} {student.lastName}
        </span>

        {!student.active && (
          <span className="mt-1 block font-sans text-xs text-slate-500">
            Inactive
          </span>
        )}
        </span>
      </button>
      <button type="button" aria-pressed={green} disabled={disabled} onClick={onToggle} className="shrink-0 rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold text-slate-700 transition-colors hover:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-600 disabled:opacity-50">
        {selected ? (student.attended ? "Remove" : "Selected") : student.attended ? "Recorded" : "Select"}
    </button>
    {green && onComplimentaryToggle && <div className="shrink-0">
      <button type="button" aria-label={`Free attendance for ${student.firstName} ${student.lastName}`} aria-pressed={complimentary} disabled={disabled} onClick={onComplimentaryToggle} className={`rounded-md border px-3 py-2 font-sans text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 disabled:opacity-50 ${complimentary ? "border-green-600 bg-green-600 text-white hover:bg-green-700" : "border-stone-300 bg-white text-slate-600 hover:border-green-500"}`}>
        {complimentary ? "✓ Free attendance" : "Free attendance"}
      </button>
    </div>}
    </div>
  );
}
