"use client";

import { useEffect, useState } from "react";

type Recurrence = "weekly" | "twice_weekly";
type Course = { id: number; name: string; recurrenceOne: Recurrence; dayOne: string; timeOne: string; recurrenceTwo: Recurrence | null; dayTwo: string | null; timeTwo: string | null };
type CourseForm = Omit<Course, "id">;
type ApiError = { error?: string };
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const emptyForm: CourseForm = { name: "", recurrenceOne: "weekly", dayOne: "Monday", timeOne: "18:00", recurrenceTwo: null, dayTwo: null, timeTwo: null };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body) return {} as T;
  try { return JSON.parse(body) as T; } catch { return {} as T; }
}

function displayTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
}

function displaySchedule(recurrence: Recurrence, day: string, time: string) {
  const frequencies: Record<Recurrence, string> = { weekly: "Every week", twice_weekly: "Two times a week" };
  return { day, time: displayTime(time), frequency: frequencies[recurrence] };
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState<CourseForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/courses").then(async (response) => {
      const data = await readJson<Course[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load courses.");
      setCourses(data);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load courses.")).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const openAddCourse = () => { setEditingId(null); setForm(emptyForm); setError(""); setFormOpen(true); };
    window.addEventListener("open-add-course", openAddCourse);
    return () => window.removeEventListener("open-add-course", openAddCourse);
  }, []);

  function closeForm() { setFormOpen(false); setEditingId(null); setForm(emptyForm); setError(""); }
  function editCourse(course: Course) {
    setEditingId(course.id); setForm({ name: course.name, recurrenceOne: course.recurrenceOne, dayOne: course.dayOne, timeOne: course.timeOne, recurrenceTwo: course.recurrenceTwo, dayTwo: course.dayTwo, timeTwo: course.timeTwo });
    setError(""); setFormOpen(true);
  }
  function setFrequency(recurrenceOne: Recurrence) {
    setForm((current) => ({ ...current, recurrenceOne, recurrenceTwo: recurrenceOne === "twice_weekly" ? "twice_weekly" : null, dayTwo: recurrenceOne === "twice_weekly" ? (current.dayTwo ?? "Thursday") : null, timeTwo: recurrenceOne === "twice_weekly" ? (current.timeTwo ?? "18:00") : null }));
  }

  async function saveCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch(editingId ? `/api/courses/${editingId}` : "/api/courses", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await readJson<Course & ApiError>(response);
      if (!response.ok) throw new Error(data.error ?? "Could not save course.");
      setCourses((current) => (editingId ? current.map((course) => course.id === editingId ? data : course) : [...current, data]).sort((a, b) => a.name.localeCompare(b.name)));
      closeForm();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save course."); }
    finally { setSaving(false); }
  }

  async function deleteCourse(course: Course) {
    if (!window.confirm(`Delete ${course.name}?`)) return;
    setError("");
    const response = await fetch(`/api/courses/${course.id}`, { method: "DELETE" });
    if (!response.ok) { const data = await readJson<ApiError>(response); setError(data.error ?? "Could not delete course."); return; }
    setCourses((current) => current.filter(({ id }) => id !== course.id));
  }

  const hasSecondSlot = form.recurrenceOne === "twice_weekly";
  return <main className="flex-1 bg-stone-50 px-6 py-6 text-slate-800 md:px-12"><div className="mx-auto max-w-5xl">
    {formOpen && <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/70 p-4 md:left-64" role="presentation"><div aria-labelledby="course-dialog-title" aria-modal="true" className="mx-auto mt-8 w-full max-w-xl rounded-xl border border-stone-200 bg-white p-6 shadow-2xl" role="dialog"><form className="space-y-5" onSubmit={saveCourse}>
      <div className="flex items-center justify-between"><h2 className="m-0 text-xl font-normal" id="course-dialog-title">{editingId ? "Edit course" : "Add course"}</h2><button aria-label="Close dialog" className="rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold" onClick={closeForm} type="button">×</button></div>
      <label className="block font-sans text-xs font-semibold text-slate-600">Course name<input autoFocus className="mt-2 w-full rounded-md border border-stone-300 px-3 py-3 font-normal text-slate-800 outline-none focus:border-lime-600" maxLength={120} required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
      <fieldset className="rounded-lg border border-stone-200 p-4"><legend className="px-1 font-sans text-xs font-bold uppercase tracking-wider text-slate-500">Class</legend><SlotFields recurrence={form.recurrenceOne} day={form.dayOne} time={form.timeOne} secondDay={hasSecondSlot ? (form.dayTwo ?? "Thursday") : null} secondTime={hasSecondSlot ? (form.timeTwo ?? "18:00") : null} onChange={(values) => { setFrequency(values.recurrence); setForm((current) => ({ ...current, dayOne: values.day, timeOne: values.time })); }} onSecondChange={(values) => setForm((current) => ({ ...current, dayTwo: values.day, timeTwo: values.time }))} /></fieldset>
      <div className="flex items-center justify-between gap-4">{error ? <p className="m-0 flex-1 font-sans text-sm text-red-700" role="alert">{error}</p> : <span className="flex-1" />}<div className="flex gap-3"><button className="rounded-md border border-stone-300 bg-white px-4 py-3 font-sans text-xs font-semibold" onClick={closeForm} type="button">Cancel</button><button className="rounded-md bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-stone-100 disabled:opacity-60" disabled={saving}>{saving ? "Saving..." : editingId ? "Save changes" : "Add course"}</button></div></div>
    </form></div></div>}
    {error && !formOpen && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-sm text-red-700" role="alert">{error}</p>}
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white">{loading ? <p className="p-8 text-center font-sans text-sm text-slate-400">Loading courses...</p> : courses.length === 0 ? <div className="p-10 text-center"><h2 className="m-0 text-xl font-normal">No courses yet</h2><p className="mt-2 font-sans text-sm text-slate-400">Use the + Add course button to add as many courses as you need.</p></div> : <div className="overflow-x-auto"><table className="w-full border-collapse text-left font-sans"><thead className="bg-stone-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-bold">Course name</th><th className="px-5 py-3 font-bold">First class</th><th className="px-5 py-3 font-bold">Second class</th><th className="px-5 py-3"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y divide-stone-200">{courses.map((course) => { const first = displaySchedule(course.recurrenceOne, course.dayOne, course.timeOne); const second = course.recurrenceTwo && course.dayTwo && course.timeTwo ? displaySchedule(course.recurrenceTwo, course.dayTwo, course.timeTwo) : null; return <tr className="hover:bg-stone-50" key={course.id}><td className="whitespace-nowrap px-5 py-4 text-sm font-semibold">{course.name}</td><td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600"><span className="block">{first.day}, {first.time}</span><span className="mt-1 block text-xs text-slate-400">{first.frequency}</span></td><td className="whitespace-nowrap px-5 py-4 text-sm text-slate-600">{second ? <><span className="block">{second.day}, {second.time}</span><span className="mt-1 block text-xs text-slate-400">{second.frequency}</span></> : <span className="text-slate-400">—</span>}</td><td className="whitespace-nowrap px-5 py-4 text-right"><button className="rounded-md border border-stone-300 bg-white px-3 py-2 text-xs font-semibold" onClick={() => editCourse(course)}>Edit</button><button aria-label={`Delete ${course.name}`} title={`Delete ${course.name}`} className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 bg-white text-red-700 hover:bg-red-50" onClick={() => void deleteCourse(course)}><svg aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7" /></svg></button></td></tr>; })}</tbody></table></div>}</section>
  </div></main>;
}

function SlotFields({ recurrence, day, time, secondDay, secondTime, onChange, onSecondChange }: { recurrence: Recurrence; day: string; time: string; secondDay: string | null; secondTime: string | null; onChange: (value: { recurrence: Recurrence; day: string; time: string }) => void; onSecondChange: (value: { day: string; time: string }) => void }) {
  const inputClass = "mt-2 w-full rounded-md border border-stone-300 bg-white px-3 py-3 text-sm font-normal text-slate-800 outline-none focus:border-lime-600";
  return <div className="grid items-start gap-4 sm:grid-cols-3"><label className="font-sans text-xs font-semibold text-slate-600">Repeats<select className={inputClass} value={recurrence} onChange={(event) => onChange({ recurrence: event.target.value as Recurrence, day, time })}><option value="weekly">Every week</option><option value="twice_weekly">Two times a week</option></select></label><div className="space-y-3"><label className="block font-sans text-xs font-semibold text-slate-600">Day<select className={inputClass} value={day} onChange={(event) => onChange({ recurrence, day: event.target.value, time })}>{days.map((weekday) => <option key={weekday}>{weekday}</option>)}</select></label>{secondDay !== null && secondTime !== null && <label className="block"><span className="sr-only">Second day</span><select aria-label="Second day" className={inputClass} value={secondDay} onChange={(event) => onSecondChange({ day: event.target.value, time: secondTime })}>{days.map((weekday) => <option key={weekday}>{weekday}</option>)}</select></label>}</div><div className="space-y-3"><label className="block font-sans text-xs font-semibold text-slate-600">Time<input className={inputClass} required type="time" value={time} onChange={(event) => onChange({ recurrence, day, time: event.target.value })} /></label>{secondDay !== null && secondTime !== null && <label className="block"><span className="sr-only">Second time</span><input aria-label="Second time" className={inputClass} required type="time" value={secondTime} onChange={(event) => onSecondChange({ day: secondDay, time: event.target.value })} /></label>}</div></div>;
}
