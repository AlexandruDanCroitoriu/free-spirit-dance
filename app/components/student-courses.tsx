"use client";

import { useEffect, useState } from "react";

type Course = { id: number; name: string; assigned: number };
async function requestCourses(url: string, options?: RequestInit): Promise<Course[]> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Could not load courses.");
  if (!Array.isArray(data)) throw new Error("Could not load courses.");
  return data;
}

export default function StudentCourses({ studentId, selected: draftSelected = [], onChange, disabled = false }: { studentId?: number; selected?: number[]; onChange?: (ids: number[]) => void; disabled?: boolean }) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [savedSelected, setSelected] = useState<number[]>([]);
  const selected = studentId === undefined ? draftSelected : savedSelected;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const url = studentId === undefined ? "/api/courses" : `/api/students/${studentId}/courses`;
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    requestCourses(url).then((data) => {
      if (!cancelled) { setCourses(data); setSelected(data.filter((course) => course.assigned).map((course) => course.id)); }
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load courses."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, retry]);
  async function save(ids: number[]) {
    if (busy || disabled) return;
    const previous = savedSelected;
    setSelected(ids);
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await requestCourses(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseIds: ids }) });
      setCourses(data); setSelected(data.filter((course) => course.assigned).map((course) => course.id)); setNotice("Courses saved."); window.dispatchEvent(new CustomEvent("student-courses-updated", { detail: studentId }));
    } catch (reason) { setSelected(previous); setError(reason instanceof Error ? reason.message : "Could not save courses."); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="student-courses-title" className="mt-6 overflow-hidden rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
    <h2 id="student-courses-title" className="m-0 text-xl font-normal">Courses</h2>
    <p className="mt-2 font-sans text-sm text-slate-500">{studentId === undefined ? "Select courses to assign when you add this student." : "Click a course to assign or remove it. Changes save automatically."}</p>
    {loading ? <p className="font-sans text-sm text-slate-500">Loading courses…</p> : courses === null ? <button type="button" onClick={() => setRetry((value) => value + 1)} className="rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">Retry loading courses</button> : courses.length === 0 ? <p className="font-sans text-sm text-slate-500">No courses available. Create a course from the Courses page first.</p> : <div>
      <CourseButtons courses={courses} selected={selected} disabled={busy || disabled} onChange={(ids) => { setNotice(""); if (studentId === undefined) onChange?.(ids); else void save(ids); }} />
      <div className="mt-4 flex items-center justify-between gap-3"><p className="m-0 font-sans text-xs text-slate-500">{selected.length} {selected.length === 1 ? "course" : "courses"} selected</p>{busy && <span role="status" className="font-sans text-xs text-slate-500">Saving…</span>}</div>
    </div>}
    {error && <p role="alert" className="mb-0 font-sans text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mb-0 font-sans text-sm text-lime-700">{notice}</p>}
  </section>;
}

export function CourseButtons({ courses, selected, disabled = false, onChange }: { courses: { id: number; name: string }[]; selected: number[]; disabled?: boolean; onChange: (ids: number[]) => void }) {
  return <div className="flex flex-wrap gap-2" role="group" aria-label="Student courses">{courses.map((course) => {
    const assigned = selected.includes(course.id);
    return <button key={course.id} type="button" aria-pressed={assigned} disabled={disabled} onClick={() => onChange(assigned ? selected.filter((id) => id !== course.id) : [...selected, course.id])} className={`rounded-lg border px-4 py-3 font-sans text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 focus-visible:ring-offset-2 disabled:opacity-50 ${assigned ? "border-green-700 bg-green-700 text-white" : "border-stone-300 bg-white text-slate-700 hover:bg-stone-100"}`}><span aria-hidden="true">{assigned ? "✓ " : "+ "}</span>{course.name}</button>;
  })}</div>;
}
