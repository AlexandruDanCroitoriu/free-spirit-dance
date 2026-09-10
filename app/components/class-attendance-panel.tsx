"use client";

import { useEffect, useRef, useState } from "react";
import {
  type CalendarClass,
  type ClassRoster,
  type ClassStudent,
} from "../lib/class-attendance";
import { formatLogDate } from "../lib/student-activity";
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
  slot,
  courseName,
  onClose,
}: {
  slot: CalendarClass;
  courseName: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [data, setData] = useState<ClassRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
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
          setSelected([]);
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
    if (
      selected.length &&
      !window.confirm("Close without submitting the selected attendance?")
    )
      return;
    onClose();
  }
  function toggle(id: number) {
    setNotice("");
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id],
    );
  }
  async function changeCancellation() {
    if (saving.current || !data) return;
    if (!data.cancelled && !window.confirm("Cancel this class occurrence?")) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await readResponse(await fetch("/api/class-attendance", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...slot, cancelled: !data.cancelled }) }));
      setSelected([]); setRetry((value) => value + 1);
      window.dispatchEvent(new Event("calendar-updated"));
      setNotice(data.cancelled ? "Class restored." : "Class cancelled.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update class."); }
    finally { saving.current = false; setBusy(false); }
  }
  async function submit() {
    if (saving.current || !selected.length || !editable) return;
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
          body: JSON.stringify({ ...slot, studentIds: ids, removeStudentIds: removedIds }),
        }),
      );
      setData((current) =>
        current
          ? {
              ...current,
              students: current.students.map((student) =>
                ids.includes(student.id)
                  ? { ...student, attended: 1 }
                  : removedIds.includes(student.id) ? { ...student, attended: 0 } : student,
              ),
            }
          : current,
      );
      setSelected([]);
      window.dispatchEvent(new Event("student-activity-updated"));
      setNotice(`Attendance saved: ${result.recorded} added, ${result.removed} removed.`);
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
  const assigned = data?.students.filter((s) => s.assigned) ?? [];
  const others = data?.students.filter((s) => !s.assigned) ?? [];
  function card(student: ClassStudent) {
    return (
      <AttendanceStudentCard
        key={student.id}
        student={student}
        selected={selected.includes(student.id)}
        disabled={busy || loading || !editable}
        onToggle={() => toggle(student.id)}
      />
    );
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="class-attendance-title"
      aria-modal="true"
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-2xl overflow-y-auto border-0 bg-stone-50 p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60"
      onCancel={(event) => {
        event.preventDefault();
        close();
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
      <div className="space-y-5 p-5">
        {data?.cancelled && <p role="status" className="rounded-lg bg-red-50 p-3 font-sans text-sm text-red-700">This class is cancelled. Attendance cannot be added.</p>}
        {data?.canManageClass && <div>
          <button type="button" className={button + " text-red-700"} disabled={busy || loading || selected.length > 0 || (!data.cancelled && data.students.some((student) => student.attended))} onClick={() => void changeCancellation()}>{data.cancelled ? "Restore class" : "Cancel class"}</button>
          {!data.cancelled && data.students.some((student) => student.attended) && <p className="font-sans text-xs text-slate-500">Remove recorded attendance before cancelling this class.</p>}
        </div>}
        {data && !editable && !data.cancelled && (
          <p className="rounded-lg bg-amber-50 p-3 font-sans text-sm text-amber-800">
            Attendance can only be changed on the class date. Only the main administrator can edit other dates.
          </p>
        )}
        {error && (
          <div role="alert" className="font-sans text-sm text-red-700">
            {error}{" "}
            <button
              type="button"
              className={button}
              disabled={busy || loading}
              onClick={() => setRetry((n) => n + 1)}
            >
              Reload students
            </button>
          </div>
        )}
        {selected.length > 500 && (
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
        {data && (
          <>
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
      </div>
      <footer className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-stone-200 bg-white p-5">
        <p className="m-0 font-sans text-xs text-slate-500">
          {selected.length} changes ·{" "}
          {data?.students.filter((s) => s.attended).length ?? 0} recorded
        </p>
        <button
          type="button"
          disabled={
            busy ||
            loading ||
            !data ||
            !selected.length ||
            selected.length > 500 ||
            !editable
          }
          onClick={() => void submit()}
          className="rounded-md bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Submit attendance"}
        </button>
      </footer>
    </dialog>
  );
}
export function AttendanceStudentCard({
  student,
  selected,
  disabled,
  onToggle,
}: {
  student: ClassStudent;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const green = Boolean(student.attended) !== selected;
  return (
    <button
      type="button"
      aria-pressed={green}
      disabled={disabled}
      onClick={onToggle}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left focus:outline-none focus:ring-2 focus:ring-green-600 ${green ? "border-green-500 bg-green-50 text-green-900" : "border-stone-200 bg-white hover:border-green-400"}`}
    >
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
      <span className="min-w-0 flex-1">
        <span className="block truncate font-sans text-sm font-semibold">
          {student.firstName} {student.lastName}
        </span>
        {!student.active && (
          <span className="mt-1 block font-sans text-xs text-slate-500">
            Inactive
          </span>
        )}
      </span>
      <span className="font-sans text-xs font-semibold">
        {selected ? (student.attended ? "Remove on submit" : "✓ Selected") : student.attended ? "✓ Recorded" : "Select"}
      </span>
    </button>
  );
}
