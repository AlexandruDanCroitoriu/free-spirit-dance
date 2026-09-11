"use client";

import { useEffect, useRef, useState } from "react";
import StudentPanel from "./student-panel";

const filterStorageKey = "free-spirit-dance.student-balances.filters.v1";

type StudentBalance = { id: number; firstName: string; lastName: string; picture: string | null; balances: { courseId: number; courseName: string; remainingAllowance: number; excessAttendance: number }[] };

export default function StudentBalancesWidget() {
  const courseDropdown = useRef<HTMLDivElement>(null);
  const courseTrigger = useRef<HTMLButtonElement>(null);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [students, setStudents] = useState<StudentBalance[]>([]);
  const [courses, setCourses] = useState<{ id: number; name: string }[]>([]);
  const [showUnpaid, setShowUnpaid] = useState(true);
  const [selectedRemaining, setSelectedRemaining] = useState<number[]>([]);
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [remaining, setRemaining] = useState("");
  const [filtersLoaded, setFiltersLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const refresh = () => setReload((n) => n + 1);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(filterStorageKey) ?? "null");
      if (saved && typeof saved === "object") {
        const values = saved as Record<string, unknown>;
        if (typeof values.showUnpaid === "boolean") setShowUnpaid(values.showUnpaid);
        else if (values.filter === "remaining") setShowUnpaid(false);
        if (Array.isArray(values.selectedRemaining)) setSelectedRemaining([...new Set(values.selectedRemaining.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4))]);
        const isCourseId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
        if (Array.isArray(values.courseIds)) setCourseIds([...new Set(values.courseIds.filter(isCourseId))]);
        else if (isCourseId(values.courseId)) setCourseIds([values.courseId]);
        if (typeof values.remaining === "string" && /^\d+$/.test(values.remaining) && Number.isSafeInteger(Number(values.remaining))) {
          if (values.filter === "remaining" && Number(values.remaining) <= 4) setSelectedRemaining([Number(values.remaining)]);
          else if (values.filter !== "unpaid") setRemaining(values.remaining);
        }
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
      window.localStorage.setItem(filterStorageKey, JSON.stringify({ showUnpaid, selectedRemaining, courseIds, remaining }));
    } catch {
      // Filters still work when browser storage is blocked or full.
    }
  }, [filtersLoaded, showUnpaid, selectedRemaining, courseIds, remaining]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/students/balances", { signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { students?: StudentBalance[]; courses?: { id: number; name: string }[]; error?: string };
      if (!response.ok || !Array.isArray(body.students) || !Array.isArray(body.courses)) throw new Error(body.error ?? "Could not load student balances.");
      if (!controller.signal.aborted) { setStudents(body.students); setCourses(body.courses); setHasLoaded(true); }
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
  useEffect(() => {
    if (!coursesOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !courseDropdown.current?.contains(event.target)) setCoursesOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCoursesOpen(false);
        courseTrigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [coursesOpen]);
  const selectedCourseNames = courseIds.map((id) => courses.find((course) => String(course.id) === id)?.name ?? "Course no longer available").join(", ");
  const validRemaining = /^\d+$/.test(remaining) && Number.isSafeInteger(Number(remaining));
  const remainingSummary = [...new Set([...selectedRemaining, ...(validRemaining ? [Number(remaining)] : [])])].sort((a, b) => a - b);
  const filterSummary = [showUnpaid ? "Unpaid" : "", remainingSummary.length ? `${remainingSummary.join(", ")} left` : ""].filter(Boolean).join(" · ") || "No balances selected";
  const matches = students.map((student) => ({ ...student, balances: student.balances.filter((balance) => (courseIds.length === 0 || courseIds.includes(String(balance.courseId))) && ((showUnpaid && balance.excessAttendance > 0) || selectedRemaining.includes(balance.remainingAllowance) || (validRemaining && balance.remainingAllowance === Number(remaining)))) })).filter((student) => student.balances.length > 0);
  return <section aria-labelledby="student-balances-title" className="min-w-0 self-start rounded-2xl border border-stone-200 bg-white shadow-sm">
    <div className="border-b border-stone-200 p-4">
      <h2 id="student-balances-title" className="m-0 text-lg font-normal">Student balances</h2>
      <details className="mt-3" onToggle={(event) => { if (!event.currentTarget.open) setCoursesOpen(false); }}>
        <summary className="cursor-pointer rounded-md font-sans text-xs font-semibold text-slate-600 focus-visible:outline-lime-600">Filters
          <span className="mt-1 block break-words font-normal text-slate-500">{filterSummary} · {selectedCourseNames || "All courses"}</span>
        </summary>
      <fieldset className="mt-3 min-w-0 font-sans text-xs text-slate-600">
        <legend className="font-semibold">Courses</legend>
        <div ref={courseDropdown} onBlur={(event) => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setCoursesOpen(false); }} className="relative mt-2 rounded-md border border-stone-300 bg-white text-sm">
          <button ref={courseTrigger} type="button" aria-expanded={coursesOpen} aria-controls="student-balance-courses" onClick={() => setCoursesOpen((open) => !open)} title={selectedCourseNames || "All courses"} className="flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-left focus-visible:outline-lime-600"><span aria-hidden="true" className="shrink-0">{coursesOpen ? "▾" : "▸"}</span><span className="truncate">{selectedCourseNames || "All courses"}</span></button>
          {coursesOpen && <div id="student-balance-courses" className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 space-y-2 overflow-y-auto rounded-md border border-stone-300 bg-white p-2 shadow-lg">
            {[...courses.map(({ id, name }) => ({ id: String(id), name })), ...courseIds.filter((id) => !courses.some((course) => String(course.id) === id)).map((id) => ({ id, name: "Course no longer available" }))].map(({ id, name }) => <label key={id} className="flex items-center gap-2">
              <input type="checkbox" checked={courseIds.includes(id)} onChange={(event) => { const checked = event.currentTarget.checked; setCourseIds((current) => checked ? [...current, id] : current.filter((courseId) => courseId !== id)); }} className="h-4 w-4 shrink-0 accent-lime-700" />
              {name}
            </label>)}
          </div>}
        </div>
      </fieldset>
      <fieldset className="mt-3 min-w-0 font-sans text-xs text-slate-600">
        <legend className="font-semibold">Show students with</legend>
        <p className="mb-0 mt-2">Select any combination. Clear the custom field to remove it.</p>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          <button type="button" aria-pressed={showUnpaid} onClick={() => setShowUnpaid((current) => !current)} className={`col-span-5 cursor-pointer rounded-md border px-2 py-2 text-sm focus-visible:outline-lime-600 ${showUnpaid ? "border-lime-700 bg-lime-100 font-semibold text-lime-900" : "border-stone-300 bg-white hover:bg-stone-50"}`}>Unpaid attendance</button>
          {[0, 1, 2, 3, 4].map((count) => <button key={count} type="button" aria-label={`${count} attendances remaining`} aria-pressed={selectedRemaining.includes(count)} onClick={() => setSelectedRemaining((current) => current.includes(count) ? current.filter((value) => value !== count) : [...current, count])} className={`cursor-pointer rounded-md border px-1 py-2 text-xs focus-visible:outline-lime-600 ${selectedRemaining.includes(count) ? "border-lime-700 bg-lime-100 font-semibold text-lime-900" : "border-stone-300 bg-white hover:bg-stone-50"}`}>{count}</button>)}
        </div>
        <label className="mt-3 block">Custom attendances remaining
          <input type="number" min="0" step="1" placeholder="Enter an amount" value={remaining} onChange={(event) => setRemaining(event.target.value)} aria-invalid={remaining !== "" && !validRemaining} aria-describedby={remaining !== "" && !validRemaining ? "student-balance-remaining-error" : undefined} className="mt-2 w-full rounded-md border border-stone-300 p-2 text-sm focus:ring-2 focus:ring-lime-600" />
        </label>
        {remaining !== "" && !validRemaining && <p id="student-balance-remaining-error" className="mb-0 mt-2 text-red-700">Enter a whole number of 0 or more.</p>}
      </fieldset>
      </details>
    </div>
    {error ? <div role="alert" className="p-4 font-sans text-sm text-red-700">{error}<button type="button" onClick={refresh} className="ml-2 underline">Retry</button></div> : loading && !hasLoaded ? <p role="status" className="p-4 font-sans text-sm text-slate-500">Loading balances…</p> : <>
      <p role="status" className="m-0 px-4 py-3 font-sans text-xs text-slate-500">{matches.length} {matches.length === 1 ? "student" : "students"}</p>
      {!matches.length && <p className="m-0 px-4 pb-4 font-sans text-sm text-slate-500">{!showUnpaid && selectedRemaining.length === 0 && !validRemaining ? "Select a balance filter to show students." : "No students match the selected balances."}</p>}
      <ul className="m-0 max-h-80 list-none divide-y divide-stone-100 overflow-y-auto p-0">{matches.map((student) => <li key={student.id}>
        <button type="button" aria-haspopup="dialog" onClick={() => setSelectedId(student.id)} className="block w-full border-0 bg-white p-4 text-left hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lime-600">
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 font-sans text-sm font-bold text-slate-800">
              {student.picture ? <img src={student.picture} alt="" loading="lazy" className="h-full w-full object-cover" /> : `${student.firstName[0] ?? ""}${student.lastName[0] ?? ""}`}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words font-sans text-sm font-semibold text-slate-800">{student.firstName} {student.lastName}</span>
              {student.balances.map((balance) => <span key={balance.courseId} className="mt-1 flex flex-wrap justify-between gap-1 font-sans text-xs"><span className="break-words text-slate-500">{balance.courseName}</span><span className={balance.excessAttendance > 0 ? "font-semibold text-red-700" : "font-semibold text-lime-700"}>{balance.excessAttendance > 0 ? `${balance.excessAttendance} unpaid` : `${balance.remainingAllowance} remaining`}</span></span>)}
            </span>
          </span>
        </button>
      </li>)}</ul>
    </>}
    {selectedId !== null && <StudentPanel key={selectedId} id={selectedId} onClose={() => { setSelectedId(null); refresh(); }} onUpdate={refresh} onDelete={() => { setSelectedId(null); refresh(); }} />}
  </section>;
}
