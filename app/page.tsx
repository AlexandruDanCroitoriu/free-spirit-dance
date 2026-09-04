"use client";

import { useEffect, useMemo, useState } from "react";

type Course = { id: number; name: string; recurrenceOne: "weekly" | "twice_weekly"; dayOne: string; startTimeOne: string; endTimeOne: string; recurrenceTwo: "twice_weekly" | null; dayTwo: string | null; startTimeTwo: string | null; endTimeTwo: string | null };
type ClassSlot = { courseId: number; courseName: string; day: string; startTime: string; endTime: string };
type SelectedClass = { course: Course; date: Date; slot: ClassSlot };
type ApiError = { error?: string };

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body) return {} as T;
  try { return JSON.parse(body) as T; } catch { return {} as T; }
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function sameDate(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth() && first.getDate() === second.getDate();
}

function displayTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
}

export default function HomePage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [visibleMonth, setVisibleMonth] = useState(() => { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedClass, setSelectedClass] = useState<SelectedClass | null>(null);

  useEffect(() => {
    fetch("/api/courses").then(async (response) => {
      const data = await readJson<Course[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load the course calendar.");
      setCourses(data);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the course calendar.")).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedClass) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedClass(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedClass]);

  const today = useMemo(() => new Date(), []);
  const firstDayOffset = (visibleMonth.getDay() + 6) % 7;
  const gridStart = addDays(visibleMonth, -firstDayOffset);
  const calendarDates = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const slots = courses.flatMap<ClassSlot>((course) => {
    const courseSlots = [{ courseId: course.id, courseName: course.name, day: course.dayOne, startTime: course.startTimeOne, endTime: course.endTimeOne }];
    if (course.recurrenceOne === "twice_weekly" && course.dayTwo && course.startTimeTwo && course.endTimeTwo) courseSlots.push({ courseId: course.id, courseName: course.name, day: course.dayTwo, startTime: course.startTimeTwo, endTime: course.endTimeTwo });
    return courseSlots;
  }).sort((first, second) => first.startTime.localeCompare(second.startTime) || first.courseName.localeCompare(second.courseName));
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(visibleMonth);
  function changeMonth(amount: number) { setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1)); }

  return <main className="flex-1 bg-stone-50 px-4 py-6 text-slate-800 md:px-12"><div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-3">
    {selectedClass && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 md:left-64" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedClass(null); }}>
      <div aria-labelledby="calendar-course-dialog-title" aria-modal="true" className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-2xl" role="dialog">
        <div className="flex items-start justify-between gap-4"><div><p className="mb-1 font-sans text-xs font-bold uppercase tracking-wider text-lime-700">Course</p><h2 className="m-0 text-xl font-normal" id="calendar-course-dialog-title">{selectedClass.course.name}</h2></div><button autoFocus aria-label="Close dialog" className="rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold" onClick={() => setSelectedClass(null)} type="button">×</button></div>
        <div className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-4 font-sans"><p className="m-0 text-sm font-semibold text-slate-800">{selectedClass.date.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p><p className="mt-1 text-sm text-slate-600">{displayTime(selectedClass.slot.startTime)}–{displayTime(selectedClass.slot.endTime)}</p></div>
        <div className="mt-5 flex justify-end gap-3"><button className="rounded-md border border-stone-300 bg-white px-4 py-3 font-sans text-xs font-semibold" onClick={() => setSelectedClass(null)} type="button">Close</button><a className="rounded-md bg-slate-800 px-4 py-3 font-sans text-xs font-bold text-stone-100" href="/courses">Manage course</a></div>
      </div>
    </div>}
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:col-span-2" aria-labelledby="calendar-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <h2 className="m-0 text-lg font-normal" id="calendar-title">Course calendar</h2>
        <div className="flex items-center gap-1.5 font-sans"><button aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(-1)}>‹</button><span className="min-w-28 px-1 text-center text-xs font-semibold text-slate-700" aria-live="polite">{monthLabel}</span><button aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(1)}>›</button></div>
      </div>
      {loading ? <p className="p-8 text-center font-sans text-xs text-slate-400">Loading calendar...</p> : error ? <p className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-xs text-red-700" role="alert">{error}</p> : courses.length === 0 ? <div className="p-8 text-center"><h3 className="m-0 text-base font-normal">No courses scheduled</h3><p className="mt-2 font-sans text-xs text-slate-400">Add a course to see it on the calendar.</p><a className="mt-3 inline-block rounded-lg bg-slate-800 px-3 py-2 font-sans text-xs font-bold text-stone-100" href="/courses">Go to courses</a></div> : <div className="overflow-x-auto"><div className="calendar-widget-body">
        <div className="calendar-grid border-b border-stone-200 bg-stone-50">{weekdays.map((day) => <div className="px-1 py-2 text-center font-sans text-[10px] font-bold uppercase tracking-wider text-slate-400" key={day}>{day.slice(0, 3)}</div>)}</div>
        <div className="calendar-grid border-l border-stone-200">{calendarDates.map((date) => { const day = weekdays[(date.getDay() + 6) % 7]; const daySlots = slots.filter((slot) => slot.day === day); const current = sameDate(date, today); const inMonth = date.getMonth() === visibleMonth.getMonth(); return <section className={`calendar-widget-day border-b border-r border-stone-200 p-1.5 ${current ? "bg-lime-50/70" : inMonth ? "bg-white" : "bg-stone-50/70"}`} key={date.toISOString()} aria-label={date.toLocaleDateString()}>
          <p className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full font-sans text-[10px] font-semibold ${current ? "bg-lime-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{date.getDate()}</p>
          <div className="space-y-1">{daySlots.map((slot, index) => <button className={`block w-full rounded border px-1.5 py-1 text-left hover:border-lime-400 focus:outline-none focus:ring-2 focus:ring-lime-600 ${inMonth ? "border-lime-200 bg-lime-50" : "border-stone-200 bg-white/60 opacity-60"}`} key={`${date.toISOString()}-${slot.courseId}-${slot.startTime}-${index}`} onClick={() => { const course = courses.find(({ id }) => id === slot.courseId); if (course) setSelectedClass({ course, date, slot }); }} title={`${slot.courseName} · ${displayTime(slot.startTime)}–${displayTime(slot.endTime)}`} type="button"><span className="block truncate font-sans text-[9px] font-bold leading-3 text-slate-800">{slot.courseName}</span><span className="block truncate font-sans text-[8px] font-semibold leading-3 text-lime-700">{displayTime(slot.startTime)}–{displayTime(slot.endTime)}</span></button>)}</div>
        </section>; })}</div>
      </div></div>}
    </section>
  </div></main>;
}
