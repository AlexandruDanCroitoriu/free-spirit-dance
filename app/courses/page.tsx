"use client";

import { requestJson } from "../lib/http";
import { useEffect, useRef, useState } from "react";
import TimeSelector from "../components/time-selector";
import OperationNotification from "../components/operation-notification";
import PaymentPresets from "../components/payment-presets";
import { weekdays, parseCourse, type Course, type CourseInput, type Schedule } from "../lib/courses";
import { formatMoney, parseAmount } from "../lib/student-activity";

const dayLabels: Record<string, string> = { Monday: "Luni", Tuesday: "Marți", Wednesday: "Miercuri", Thursday: "Joi", Friday: "Vineri", Saturday: "Sâmbătă", Sunday: "Duminică" };
const newSchedule = (): Schedule => ({ day: "Monday", startTime: "18:00", endTime: "19:00", rentCostMinor: 0 });
const emptyForm = (): CourseInput => ({ name: "", startDate: "", endDate: "", schedules: [newSchedule()] });
const inputClass = "mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-3 text-sm font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-lime-600";
const buttonClass = "rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold disabled:opacity-50";
const primaryClass = "rounded-md bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-stone-100 disabled:opacity-50";

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [tab, setTab] = useState<"courses" | "payment-presets">("courses");
  const [form, setForm] = useState<CourseInput>(emptyForm);
  const [rentCosts, setRentCosts] = useState<Record<string, string>>({ Monday: "0.00" });
  const [presetAmount, setPresetAmount] = useState("");
  const [presetAllowance, setPresetAllowance] = useState("1");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [operationError, setOperationError] = useState("");
  const panel = useRef<HTMLDialogElement>(null);
  const discardDialog = useRef<HTMLDialogElement>(null);
  const initialForm = useRef("");
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [discardChanges, setDiscardChanges] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Pick<Course, "id" | "name"> | null>(null);

  const [relationships, setRelationships] = useState<{ table: string; label: string; count: number }[] | null>(null);
  const [relationshipError, setRelationshipError] = useState("");
  const [relationshipRetry, setRelationshipRetry] = useState(0);
  const canDelete = relationships !== null && relationships.every((item) => item.table === "course_schedule" || item.table === "classes" || item.count === 0) && !relationshipError;

  useEffect(() => {
    setRelationships(null); setRelationshipError("");
    if (!deleteTarget) return;
    const controller = new AbortController();
    requestJson<{ relationships: { table: string; label: string; count: number }[] }>(`/api/courses/${deleteTarget.id}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setRelationships(data.relationships); })
      .catch((reason) => { if (!controller.signal.aborted) setRelationshipError(reason instanceof Error ? reason.message : "Could not load relationships."); });
    return () => controller.abort();
  }, [deleteTarget, relationshipRetry]);

  useEffect(() => {
    if (!deleteTarget) return;
    const dialog = deleteDialog.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [deleteTarget]);

  async function load() {
    setLoading(true); setError("");
    try {
      const items = await requestJson<Course[]>("/api/courses");
      if (!Array.isArray(items)) throw new Error("Could not load courses.");
      setCourses(items); setLoaded(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load courses."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function formSnapshot(value: CourseInput, costs: Record<string, string>, amount: string, allowance: string) {
    return JSON.stringify({ value, costs: Object.fromEntries(value.schedules.map((schedule) => [schedule.day, costs[schedule.day] ?? ""])), amount, allowance });
  }
  useEffect(() => {
    const open = () => {
      if (busy) return;
      const fresh = emptyForm(), costs = { Monday: "0.00" };
      initialForm.current = formSnapshot(fresh, costs, "", "1");
      setForm(fresh); setRentCosts(costs); setPresetAmount(""); setPresetAllowance("1"); setEditingId(null); setError(""); setNotice(""); setOperationError(""); setFormOpen(true);
    };
    window.addEventListener("open-add-course", open);
    return () => window.removeEventListener("open-add-course", open);
  }, [busy]);
  useEffect(() => { if (window.location.hash === "#payment-presets") setTab("payment-presets"); }, []);
  useEffect(() => {
    if (!formOpen) return;
    const dialog = panel.current;
    const focus = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog?.showModal(); document.body.style.overflow = "hidden";
    return () => {
      dialog?.close(); document.body.style.overflow = overflow;
      if (focus instanceof HTMLElement) focus.focus();
    };
  }, [formOpen]);
  useEffect(() => {
    if (!discardChanges) return;
    discardDialog.current?.showModal();
    return () => discardDialog.current?.close();
  }, [discardChanges]);
  function dismissForm() { setDiscardChanges(false); setFormOpen(false); setError(""); }
  function close() {
    if (busy) return;
    if (initialForm.current !== formSnapshot(form, rentCosts, presetAmount, presetAllowance)) { setDiscardChanges(true); return; }
    dismissForm();
  }
  function edit(course: Course) {
    const schedules = course.schedules.length ? course.schedules.map((s) => ({ ...s })) : [newSchedule()];
    const value = { name: course.name, startDate: course.startDate ?? "", endDate: course.endDate ?? "", schedules }, costs = Object.fromEntries(schedules.map((schedule) => [schedule.day, (schedule.rentCostMinor / 100).toFixed(2)])), amount = course.paymentPreset ? (course.paymentPreset.amountMinor / 100).toFixed(2) : "", allowance = course.paymentPreset ? String(course.paymentPreset.allowance) : "1";
    initialForm.current = formSnapshot(value, costs, amount, allowance);
    setForm(value); setRentCosts(costs); setPresetAmount(amount); setPresetAllowance(allowance); setEditingId(course.id); setError(""); setNotice(""); setOperationError(""); setFormOpen(true);
  }
  function updateSchedule(index: number, values: Partial<Schedule>) {
    setForm((current) => ({ ...current, schedules: current.schedules.map((s, i) => i === index ? { ...s, ...values } : s) }));
  }
  function toggleDay(day: string) {
    setRentCosts((current) => ({ ...current, [day]: current[day] ?? "0.00" }));
    setForm((current) => {
      if (current.schedules.some((schedule) => schedule.day === day)) {
        return { ...current, schedules: current.schedules.filter((schedule) => schedule.day !== day) };
      }
      if (current.schedules.length >= 5) return current;
      return { ...current, schedules: [...current.schedules, { ...newSchedule(), day }].sort((a, b) => weekdays.indexOf(a.day) - weekdays.indexOf(b.day)) };
    });
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setOperationError("");
    const schedules = form.schedules.map((schedule) => {
      const cost = rentCosts[schedule.day] ?? "";
      const rentCostMinor = cost.trim() === "" || /^0(?:[.,]0{0,2})?$/.test(cost.trim()) ? 0 : parseAmount(cost);
      return rentCostMinor === null ? null : { ...schedule, rentCostMinor };
    });
    if (schedules.some((schedule) => schedule === null)) { setError("Enter a rent cost from 0 to 999,999.99 RON for each class day."); return; }
    const input = parseCourse({ ...form, schedules: schedules as Schedule[] });
    if (typeof input === "string") { setError(input); return; }
    const amountMinor = parseAmount(presetAmount);
    const allowance = Number(presetAllowance);
    if (amountMinor === null) { setError("Enter a positive payment preset amount from 0.01 to 999,999.99 RON."); return; }
    if (!Number.isSafeInteger(allowance) || allowance < 1 || allowance > 10_000) { setError("Enter between 1 and 10,000 classes for the payment preset."); return; }
    setBusy(true);
    try {
      const saved = await requestJson<Course>(editingId === null ? "/api/courses" : `/api/courses/${editingId}`, {
        method: editingId === null ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, paymentPreset: { amountMinor, allowance } }),
      });
      setCourses((current) => [...current.filter((c) => c.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setLoaded(true); dismissForm(); setNotice("Course saved.");
    } catch (reason) { setOperationError(reason instanceof Error ? reason.message : "Could not save course."); }
    finally { setBusy(false); }
  }
  async function remove(course: Pick<Course, "id" | "name">) {
    if (busy || !canDelete) return;

    setBusy(true); setError(""); setNotice(""); setOperationError("");
    try {
      await requestJson<void>(`/api/courses/${course.id}`, { method: "DELETE" });
      setCourses((current) => current.filter((c) => c.id !== course.id)); setFormOpen(false); setEditingId(null); setNotice("Course deleted."); setDeleteTarget(null);
    } catch (reason) { setRelationshipError(reason instanceof Error ? reason.message : "Could not delete course."); setRelationships(null); }
    finally { setBusy(false); }
  }

  return <main className="flex-1 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl space-y-4">
    <OperationNotification message={operationError} kind="error" onDismiss={() => setOperationError("")} />
    <OperationNotification message={notice} onDismiss={() => setNotice("")} />
    {error && !formOpen && <p role="alert" className="rounded-lg bg-red-50 p-3 font-sans text-sm text-red-700">{error}{!loaded && <button className={buttonClass + " ml-3"} onClick={() => void load()}>Retry</button>}</p>}
    {formOpen && <dialog ref={panel} aria-labelledby="course-panel-title" aria-modal="true"
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-xl overflow-y-auto border-0 bg-white p-6 text-slate-800 shadow-2xl backdrop:bg-slate-950/60"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}>
      <div className="flex items-center justify-between gap-4"><h2 id="course-panel-title" className="m-0 text-xl font-normal">{editingId === null ? "Add course" : "Edit course"}</h2><button type="button" aria-label="Close course panel" className={buttonClass} disabled={busy} onClick={close}>×</button></div>
      <form onSubmit={save} className="mt-5 space-y-5">
        <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
          <label className="block font-sans text-xs font-semibold text-slate-600">Course name<input autoFocus required maxLength={120} className={inputClass} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <fieldset className="rounded-lg border border-stone-200 p-4 font-sans text-xs text-slate-600">
            <legend className="px-1 font-semibold">Course payment preset</legend>
            <p className="mb-0 mt-1 font-normal text-slate-500">This preset uses the course name and is managed here.</p>
            <div className="mt-3 grid grid-cols-2 gap-3 font-semibold"><label>Amount (RON)<input required inputMode="decimal" pattern="[0-9]{1,6}([.,][0-9]{1,2})?" maxLength={9} placeholder="e.g. 200.00" className={inputClass} value={presetAmount} onChange={(event) => setPresetAmount(event.target.value)} /></label><label>Classes covered<input required type="number" min="1" max="10000" step="1" className={inputClass} value={presetAllowance} onChange={(event) => setPresetAllowance(event.target.value)} /></label></div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3 font-sans text-xs font-semibold text-slate-600">
            <label>Start date<input required type="date" min="1900-01-01" max={form.endDate || "9999-12-31"} className={inputClass} value={form.startDate ?? ""} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} /></label>
            <label>End date (optional)<input type="date" min={form.startDate || "1900-01-01"} max="9999-12-31" className={inputClass} value={form.endDate ?? ""} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} /></label>
          </div>
          <p className="font-sans text-xs text-slate-500">Weekly classes appear from the start date through the end date, inclusive. Leave the end date empty for an ongoing course.</p>
          <fieldset className="min-w-0 font-sans text-xs font-semibold text-slate-600">
            <legend>Days of the week</legend>
            <p className="mt-2 text-xs font-normal text-slate-500">Select up to 5 days ({new Set(form.schedules.map((schedule) => schedule.day)).size}/5).</p>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {weekdays.map((day) => {
                const selected = form.schedules.some((schedule) => schedule.day === day);
                return <label key={day} className="min-w-0 cursor-pointer" title={dayLabels[day]}>
                  <input type="checkbox" name="course-days" value={day} checked={selected} disabled={!selected && form.schedules.length >= 5} onChange={() => toggleDay(day)} aria-label={dayLabels[day]} className="peer sr-only" />
                  <span className="flex min-h-11 items-center justify-center rounded-lg border border-stone-200 bg-white px-1 text-[11px] text-slate-600 transition-colors hover:border-lime-400 peer-checked:border-lime-600 peer-checked:bg-lime-100 peer-checked:text-lime-900 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-lime-600 peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-40">
                    <span className="sm:hidden" aria-hidden="true">{dayLabels[day].slice(0, 3)}</span><span className="hidden sm:inline" aria-hidden="true">{dayLabels[day]}</span>
                  </span>
                </label>;
              })}
            </div>
          </fieldset>
          {form.schedules.length === 0 && <p className="font-sans text-sm text-slate-500">Select a day to set its class times.</p>}
          {form.schedules.map((schedule, index) => <fieldset key={`${schedule.day}-${form.schedules.slice(0, index).filter((item) => item.day === schedule.day).length}`} className="rounded-lg border border-stone-200 p-4">
            <legend className="px-1 font-sans text-xs font-bold text-slate-500">{dayLabels[schedule.day]}</legend>
            <div className="grid grid-cols-2 gap-3">
              <TimeSelector label="Start time" value={schedule.startTime} onChange={(startTime) => updateSchedule(index, { startTime })} />
              <TimeSelector label="End time" value={schedule.endTime} onChange={(endTime) => updateSchedule(index, { endTime })} />
            </div>
            <label className="mt-3 block font-sans text-xs font-semibold text-slate-600">Rent cost for this class (RON)<input required inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,5})(?:[.,][0-9]{1,2})?" maxLength={9} className={inputClass} value={rentCosts[schedule.day] ?? ""} onChange={(event) => setRentCosts((current) => ({ ...current, [schedule.day]: event.target.value }))} /><span className="mt-1 block font-normal text-slate-500">This amount is copied into each recorded class.</span></label>
          </fieldset>)}
        </fieldset>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 font-sans text-sm text-red-700">{error}</p>}
        <div className="sticky -bottom-6 -mx-6 flex justify-end gap-3 border-t border-stone-200 bg-white px-6 py-4">{editingId !== null && <button type="button" className={buttonClass + " mr-auto border-red-200 text-red-700"} disabled={busy} onClick={() => setDeleteTarget({ id: editingId, name: courses.find((course) => course.id === editingId)?.name ?? form.name })}>Delete course</button>}<button type="button" className={buttonClass} disabled={busy} onClick={close}>Cancel</button><button className={primaryClass} disabled={busy}>{busy ? "Saving…" : "Save course"}</button></div>
      </form>
    </dialog>}
    {discardChanges && <dialog ref={discardDialog} aria-labelledby="discard-course-title" aria-describedby="discard-course-description" aria-modal="true" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-stone-200 bg-white p-6 text-slate-800 shadow-2xl backdrop:bg-slate-950/70" onCancel={(event) => { event.preventDefault(); setDiscardChanges(false); }}>
      <h2 id="discard-course-title" className="m-0 text-xl font-semibold">Discard changes?</h2>
      <p id="discard-course-description" className="mt-3 font-sans text-sm leading-6 text-slate-600">You have unsaved changes to this course. Do you want to leave without saving them?</p>
      <div className="mt-6 flex justify-end gap-3"><button autoFocus type="button" className={buttonClass} onClick={() => setDiscardChanges(false)}>Keep editing</button><button type="button" className="rounded-md bg-red-700 px-4 py-3 font-sans text-xs font-bold text-white hover:bg-red-800" onClick={dismissForm}>Discard changes</button></div>
    </dialog>}
    {deleteTarget && <dialog ref={deleteDialog} aria-labelledby="delete-course-title" aria-describedby="delete-course-description" aria-modal="true"
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-red-200 bg-white p-6 text-slate-800 shadow-2xl backdrop:bg-slate-950/70"
      onCancel={(event) => { event.preventDefault(); if (!busy) setDeleteTarget(null); }}>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-700">
        <svg aria-hidden="true" className="h-7 w-7 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path d="M12 3 2 21h20L12 3Z" strokeLinejoin="round" /><path d="M12 9v5" strokeLinecap="round" /><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" /></svg>
      </div>
      <h2 id="delete-course-title" className="m-0 text-xl font-semibold text-red-700">Delete course?</h2>
      <p id="delete-course-description" className="mt-3 font-sans text-sm leading-6 text-slate-600">This will permanently delete <strong>{deleteTarget.name}</strong> along with its weekly schedule and recorded classes without attendance, once it has no other linked records. This cannot be undone.</p>
      <div className="mt-4 font-sans text-sm">
        <h3 className="font-semibold">Current relationships</h3>
        {!relationships && !relationshipError && <p role="status">Loading relationships…</p>}
        {relationshipError && <p role="alert" className="text-red-700">{relationshipError} <button type="button" className={buttonClass} disabled={busy} onClick={() => setRelationshipRetry((value) => value + 1)}>Retry</button></p>}
        {relationships && <ul className="mt-2 space-y-2">{relationships.map((item) => <li key={item.table} className="flex justify-between gap-4"><span>{item.label}{item.table === "course_schedule" ? " (removed automatically)" : item.table === "classes" ? " (removed automatically if no attendance)" : ""}</span><strong>{item.count}</strong></li>)}</ul>}
        {relationships && !canDelete && <p className="mt-3 text-amber-800">Deletion is disabled while attendance or other linked records exist. Remove or reassign these relationships first.</p>}
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <button autoFocus type="button" className={buttonClass} disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button>
        <button type="button" className="rounded-md bg-red-700 px-4 py-3 font-sans text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50" disabled={busy || !canDelete} onClick={() => void remove(deleteTarget)}>{busy ? "Deleting…" : "Delete course"}</button>
      </div>
    </dialog>}
    <div className="border-b border-stone-200"><nav aria-label="Courses sections" className="flex gap-5"><button type="button" aria-current={tab === "courses" ? "page" : undefined} className={`border-b-2 px-1 py-3 font-sans text-sm font-semibold ${tab === "courses" ? "border-lime-600 text-slate-800" : "border-transparent text-slate-500 hover:text-slate-800"}`} onClick={() => setTab("courses")}>Courses</button><button id="payment-presets" type="button" aria-current={tab === "payment-presets" ? "page" : undefined} className={`border-b-2 px-1 py-3 font-sans text-sm font-semibold ${tab === "payment-presets" ? "border-lime-600 text-slate-800" : "border-transparent text-slate-500 hover:text-slate-800"}`} onClick={() => setTab("payment-presets")}>Payment presets</button></nav></div>
    {tab === "payment-presets" ? <div className="pt-5"><PaymentPresets /></div> : <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">
      {loading ? <p className="p-8 text-center font-sans text-sm text-slate-500">Loading courses…</p> : !loaded ? <p className="p-8 text-center font-sans text-sm">Courses could not be loaded.</p> : courses.length === 0 ? <div className="p-10 text-center"><h2 className="text-xl font-normal">No courses yet</h2><button className={primaryClass} onClick={() => window.dispatchEvent(new Event("open-add-course"))}>+ Add course</button></div> : <div className="overflow-x-auto"><table className="w-full text-left font-sans text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Course name</th><th className="px-5 py-3">Weekly schedule</th><th className="px-5 py-3"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody className="divide-y divide-stone-200">{courses.map((course) => <tr key={course.id} className="hover:bg-stone-50">
          <td className="px-5 py-4 align-top font-semibold">{course.name}</td>
          <td className="px-5 py-4 text-slate-600">{course.schedules.length ? <ul className="m-0 list-none space-y-2 p-0">{course.schedules.map((s, i) => <li key={i} className="whitespace-nowrap">{dayLabels[s.day] ?? s.day}, {s.startTime}–{s.endTime} · {formatMoney(s.rentCostMinor)}</li>)}</ul> : "No classes scheduled"}</td>
          <td className="px-5 py-4 text-right align-top"><div className="flex justify-end gap-2"><button className={buttonClass} disabled={busy} onClick={() => edit(course)}>Edit<span className="sr-only"> {course.name}</span></button></div></td>
        </tr>)}</tbody>
      </table></div>}
    </section>}
  </div></main>;
}
