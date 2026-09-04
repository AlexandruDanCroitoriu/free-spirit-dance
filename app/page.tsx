"use client";

import { useEffect, useMemo, useState } from "react";

type Course = { id: number; name: string; recurrenceOne: "weekly" | "twice_weekly"; dayOne: string; timeOne: string; recurrenceTwo: "twice_weekly" | null; dayTwo: string | null; timeTwo: string | null };
type ClassSlot = { courseId: number; courseName: string; day: string; time: string };
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

  useEffect(() => {
    fetch("/api/courses").then(async (response) => {
      const data = await readJson<Course[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load the course calendar.");
      setCourses(data);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the course calendar.")).finally(() => setLoading(false));
  }, []);

  const today = useMemo(() => new Date(), []);
  const firstDayOffset = (visibleMonth.getDay() + 6) % 7;
  const gridStart = addDays(visibleMonth, -firstDayOffset);
  const calendarDates = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const slots = courses.flatMap<ClassSlot>((course) => {
    const courseSlots = [{ courseId: course.id, courseName: course.name, day: course.dayOne, time: course.timeOne }];
    if (course.recurrenceOne === "twice_weekly" && course.dayTwo && course.timeTwo) courseSlots.push({ courseId: course.id, courseName: course.name, day: course.dayTwo, time: course.timeTwo });
    return courseSlots;
  }).sort((first, second) => first.time.localeCompare(second.time) || first.courseName.localeCompare(second.courseName));
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(visibleMonth);
  function changeMonth(amount: number) { setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1)); }

  return <main className="flex-1 bg-stone-50 px-4 py-6 text-slate-800 md:px-12"><div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-3">
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:col-span-2" aria-labelledby="calendar-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <h2 className="m-0 text-lg font-normal" id="calendar-title">Course calendar</h2>
        <div className="flex items-center gap-1.5 font-sans"><button aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(-1)}>‹</button><span className="min-w-28 px-1 text-center text-xs font-semibold text-slate-700" aria-live="polite">{monthLabel}</span><button aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(1)}>›</button></div>
      </div>
      {loading ? <p className="p-8 text-center font-sans text-xs text-slate-400">Loading calendar...</p> : error ? <p className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-xs text-red-700" role="alert">{error}</p> : courses.length === 0 ? <div className="p-8 text-center"><h3 className="m-0 text-base font-normal">No courses scheduled</h3><p className="mt-2 font-sans text-xs text-slate-400">Add a course to see it on the calendar.</p><a className="mt-3 inline-block rounded-lg bg-slate-800 px-3 py-2 font-sans text-xs font-bold text-stone-100" href="/courses">Go to courses</a></div> : <div className="overflow-x-auto"><div className="calendar-widget-body">
        <div className="calendar-grid border-b border-stone-200 bg-stone-50">{weekdays.map((day) => <div className="px-1 py-2 text-center font-sans text-[10px] font-bold uppercase tracking-wider text-slate-400" key={day}>{day.slice(0, 3)}</div>)}</div>
        <div className="calendar-grid border-l border-stone-200">{calendarDates.map((date) => { const day = weekdays[(date.getDay() + 6) % 7]; const daySlots = slots.filter((slot) => slot.day === day); const current = sameDate(date, today); const inMonth = date.getMonth() === visibleMonth.getMonth(); return <section className={`calendar-widget-day border-b border-r border-stone-200 p-1.5 ${current ? "bg-lime-50/70" : inMonth ? "bg-white" : "bg-stone-50/70"}`} key={date.toISOString()} aria-label={date.toLocaleDateString()}>
          <p className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full font-sans text-[10px] font-semibold ${current ? "bg-lime-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{date.getDate()}</p>
          <div className="space-y-1">{daySlots.map((slot, index) => <article className={`rounded border px-1.5 py-1 ${inMonth ? "border-lime-200 bg-lime-50" : "border-stone-200 bg-white/60 opacity-60"}`} key={`${date.toISOString()}-${slot.courseId}-${slot.time}-${index}`} title={`${slot.courseName} · ${displayTime(slot.time)}`}><p className="m-0 truncate font-sans text-[9px] font-bold leading-3 text-slate-800">{slot.courseName}</p><p className="truncate font-sans text-[8px] font-semibold leading-3 text-lime-700">{displayTime(slot.time)}</p></article>)}</div>
        </section>; })}</div>
      </div></div>}
    </section>
  </div></main>;
}
