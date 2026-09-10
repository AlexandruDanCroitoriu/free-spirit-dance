"use client";

import { useEffect, useState } from "react";
import StudentPanel from "./student-panel";

const filterStorageKey = "free-spirit-dance.student-balances.filters.v1";

type StudentBalance = { id: number; firstName: string; lastName: string; picture: string | null; balances: { courseId: number; courseName: string; remainingAllowance: number; excessAttendance: number }[] };

export default function StudentBalancesWidget() {
  const [students, setStudents] = useState<StudentBalance[]>([]);
  const [courses, setCourses] = useState<{ id: number; name: string }[]>([]);
  const [filter, setFilter] = useState("unpaid");
  const [courseId, setCourseId] = useState("all");
  const [remaining, setRemaining] = useState("1");
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const refresh = () => setReload((n) => n + 1);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(filterStorageKey) ?? "null");
      if (saved && typeof saved === "object") {
        const values = saved as Record<string, unknown>;
        if (values.filter === "unpaid" || values.filter === "remaining") setFilter(values.filter);
        if (typeof values.courseId === "string" && (values.courseId === "all" || (/^[1-9]\d*$/.test(values.courseId) && Number.isSafeInteger(Number(values.courseId))))) setCourseId(values.courseId);
        if (typeof values.remaining === "string" && /^\d+$/.test(values.remaining) && Number.isSafeInteger(Number(values.remaining))) setRemaining(values.remaining);
      }
    } catch {
      // Invalid or unavailable storage must not prevent using the widget.
    }
    setFiltersLoaded(true);
  }, []);
  useEffect(() => {
    // Wait for restoration so initial defaults cannot overwrite saved filters.
    if (!filtersLoaded) return;
    try {
      window.localStorage.setItem(filterStorageKey, JSON.stringify({ filter, courseId, remaining }));
    } catch {
      // Filters still work when browser storage is blocked or full.
    }
  }, [filtersLoaded, filter, courseId, remaining]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/students/balances", { signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { students?: StudentBalance[]; courses?: { id: number; name: string }[]; error?: string };
      if (!response.ok || !Array.isArray(body.students) || !Array.isArray(body.courses)) throw new Error(body.error ?? "Could not load student balances.");
      if (!controller.signal.aborted) { setStudents(body.students); setCourses(body.courses); }
    }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load student balances."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    window.addEventListener("calendar-updated", refresh);
    window.addEventListener("student-activity-updated", refresh);
    window.addEventListener("student-courses-updated", refresh);
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 60_000);
    return () => { window.removeEventListener("calendar-updated", refresh); window.removeEventListener("student-activity-updated", refresh); window.removeEventListener("student-courses-updated", refresh); window.removeEventListener("focus", refresh); window.clearInterval(interval); };
  }, []);
  const validRemaining = /^\d+$/.test(remaining) && Number.isSafeInteger(Number(remaining));
  const matches = students.map((student) => ({ ...student, balances: student.balances.filter((balance) => (courseId === "all" || String(balance.courseId) === courseId) && (filter === "unpaid" ? balance.excessAttendance > 0 : validRemaining && balance.remainingAllowance === Number(remaining))) })).filter((student) => student.balances.length > 0);
  return <section aria-labelledby="student-balances-title" className="min-w-0 self-start overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
    <div className="border-b border-stone-200 p-4">
      <h2 id="student-balances-title" className="m-0 text-lg font-normal">Student balances</h2>
      <label className="mt-3 block font-sans text-xs font-semibold text-slate-600">Course
        <select value={courseId} onChange={(event) => setCourseId(event.target.value)} className="mt-2 w-full rounded-md border border-stone-300 bg-white p-2 text-sm focus:ring-2 focus:ring-lime-600">
          <option value="all">All courses</option>
          {courseId !== "all" && !courses.some(({ id }) => String(id) === courseId) && <option value={courseId}>Course no longer available</option>}
          {courses.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label className="mt-3 block font-sans text-xs font-semibold text-slate-600">Show students with
        <select value={filter} onChange={(event) => setFilter(event.target.value)} className="mt-2 w-full rounded-md border border-stone-300 bg-white p-2 text-sm focus:ring-2 focus:ring-lime-600">
          <option value="unpaid">Unpaid attendance</option><option value="remaining">Class credits remaining</option>
        </select>
      </label>
      {filter === "remaining" && <label className="mt-3 flex items-center justify-between gap-3 font-sans text-xs text-slate-600">Exactly this many credits
        <input aria-label="Class credits remaining" type="number" min="0" step="1" value={remaining} onChange={(event) => setRemaining(event.target.value)} className="w-20 rounded-md border border-stone-300 p-2 text-sm focus:ring-2 focus:ring-lime-600" />
      </label>}
    </div>
    {error ? <div role="alert" className="p-4 font-sans text-sm text-red-700">{error}<button type="button" onClick={refresh} className="ml-2 underline">Retry</button></div> : loading ? <p role="status" className="p-4 font-sans text-sm text-slate-500">Loading balances…</p> : <>
      <p role="status" className="m-0 px-4 py-3 font-sans text-xs text-slate-500">{matches.length} {matches.length === 1 ? "student" : "students"}</p>
      {!matches.length && <p className="m-0 px-4 pb-4 font-sans text-sm text-slate-500">{filter === "unpaid" ? courseId === "all" ? "No students have unpaid attendance." : "No students have unpaid attendance in this course." : "No students match this credit balance."}</p>}
      <ul className="m-0 max-h-80 list-none divide-y divide-stone-100 overflow-y-auto p-0">{matches.map((student) => <li key={student.id}>
        <button type="button" aria-haspopup="dialog" onClick={() => setSelectedId(student.id)} className="block w-full border-0 bg-white p-4 text-left hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lime-600">
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 font-sans text-sm font-bold text-slate-800">
              {student.picture ? <img src={student.picture} alt="" loading="lazy" className="h-full w-full object-cover" /> : `${student.firstName[0] ?? ""}${student.lastName[0] ?? ""}`}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words font-sans text-sm font-semibold text-slate-800">{student.firstName} {student.lastName}</span>
              {student.balances.map((balance) => <span key={balance.courseId} className="mt-1 flex flex-wrap justify-between gap-1 font-sans text-xs"><span className="break-words text-slate-500">{balance.courseName}</span><span className={filter === "unpaid" ? "font-semibold text-red-700" : "font-semibold text-lime-700"}>{filter === "unpaid" ? `${balance.excessAttendance} unpaid` : `${balance.remainingAllowance} remaining`}</span></span>)}
            </span>
          </span>
        </button>
      </li>)}</ul>
    </>}
    {selectedId !== null && <StudentPanel key={selectedId} id={selectedId} onClose={() => { setSelectedId(null); refresh(); }} onUpdate={refresh} onDelete={() => { setSelectedId(null); refresh(); }} />}
  </section>;
}
