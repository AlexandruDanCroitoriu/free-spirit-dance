"use client";

import { readJson } from "./lib/http";
import { useEffect, useMemo, useState } from "react";
import StudentBalancesWidget from "./components/student-balances-widget";
import ClassAttendancePanel from "./components/class-attendance-panel";
import { schoolToday } from "./lib/student-activity";
import { weekdays, type Course } from "./lib/courses";

type ClassSlot = { startDate: string | null; endDate: string | null; courseId: number; courseName: string; day: string; startTime: string; endTime: string };
type SelectedClass = { course: Course; date: Date; slot: ClassSlot };
type ApiError = { error?: string };

const dayLabels: Record<string, string> = { Monday: "Luni", Tuesday: "Marți", Wednesday: "Miercuri", Thursday: "Joi", Friday: "Vineri", Saturday: "Sâmbătă", Sunday: "Duminică" };

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
  const [calendarReload, setCalendarReload] = useState(0);
  const [visibleMonth, setVisibleMonth] = useState(() => { const date = new Date(schoolToday() + "T12:00:00"); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedClass, setSelectedClass] = useState<SelectedClass | null>(null);

  useEffect(() => {
    fetch("/api/calendar").then(async (response) => {
      const data = await readJson<Course[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load the course calendar.");
      setCourses(data);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load the course calendar.")).finally(() => setLoading(false));
  }, [calendarReload]);
  useEffect(() => {
    const refresh = () => setCalendarReload((value) => value + 1);
    window.addEventListener("calendar-updated", refresh);
    return () => window.removeEventListener("calendar-updated", refresh);
  }, []);

  const today = useMemo(() => new Date(schoolToday() + "T12:00:00"), []);
  const firstDayOffset = (visibleMonth.getDay() + 6) % 7;
  const gridStart = addDays(visibleMonth, -firstDayOffset);
  const calendarDates = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const slots = courses.flatMap<ClassSlot>((course) =>
    course.schedules.map((schedule) => ({ courseId: course.id, courseName: course.name, startDate: course.startDate, endDate: course.endDate, ...schedule }))
  ).sort((first, second) => first.startTime.localeCompare(second.startTime) || first.courseName.localeCompare(second.courseName));
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(visibleMonth);
  function changeMonth(amount: number) { setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1)); }

  return <main className="flex-1 bg-stone-50 px-4 py-6 text-slate-800 md:px-12"><div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-3">
    {selectedClass && <ClassAttendancePanel courseName={selectedClass.course.name} slot={{ courseId: selectedClass.slot.courseId, classDate: `${selectedClass.date.getFullYear()}-${String(selectedClass.date.getMonth() + 1).padStart(2, "0")}-${String(selectedClass.date.getDate()).padStart(2, "0")}`, startTime: selectedClass.slot.startTime }} onClose={() => setSelectedClass(null)} />}
    <section className="min-w-0 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:col-span-2" aria-labelledby="calendar-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <h2 className="m-0 text-lg font-normal" id="calendar-title">Course calendar</h2>
        <div className="flex items-center gap-1.5 font-sans"><button aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(-1)}>‹</button><span className="min-w-28 px-1 text-center text-xs font-semibold text-slate-700" aria-live="polite">{monthLabel}</span><button aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(1)}>›</button></div>
      </div>
      {loading ? <p className="p-8 text-center font-sans text-xs text-slate-400">Loading calendar...</p> : error ? <p className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-xs text-red-700" role="alert">{error}</p> : courses.length === 0 ? <div className="p-8 text-center"><h3 className="m-0 text-base font-normal">No courses scheduled</h3><p className="mt-2 font-sans text-xs text-slate-400">Add a course to see it on the calendar.</p><a className="mt-3 inline-block rounded-lg bg-slate-800 px-3 py-2 font-sans text-xs font-bold text-stone-100" href="/courses">Go to courses</a></div> : <div className="min-w-0"><div className="calendar-widget-body">
        <div className="calendar-grid border-b border-stone-200 bg-stone-50">{weekdays.map((day) => <div className="px-1 py-2 text-center font-sans text-[10px] font-bold uppercase tracking-wider text-slate-400" key={day}>{dayLabels[day].slice(0, 3)}</div>)}</div>
        <div className="calendar-grid border-l border-stone-200">{calendarDates.map((date) => { const day = weekdays[(date.getDay() + 6) % 7]; const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; const daySlots = slots.filter((slot) => slot.day === day && (!slot.startDate || dateKey >= slot.startDate) && (!slot.endDate || dateKey <= slot.endDate)); for (const course of courses) for (const occurrence of course.occurrences ?? []) {
          if (occurrence.classDate !== dateKey) continue;
          const existing = daySlots.findIndex((slot) => slot.courseId === course.id && slot.startTime === occurrence.startTime);
          const recorded = { courseId: course.id, courseName: course.name, day, startTime: occurrence.startTime, endTime: occurrence.endTime ?? "", startDate: course.startDate, endDate: course.endDate };
          if (existing >= 0) daySlots[existing] = recorded; else daySlots.push(recorded);
        }
        daySlots.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.courseName.localeCompare(b.courseName));
        const current = sameDate(date, today); const inMonth = date.getMonth() === visibleMonth.getMonth(); return <section className={`calendar-widget-day border-b border-r border-stone-200 p-0.5 sm:p-1.5 ${current ? "bg-lime-50/70" : inMonth ? "bg-white" : "bg-stone-50/70"}`} key={date.toISOString()} aria-label={date.toLocaleDateString()}>
          <p className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full font-sans text-[10px] font-semibold ${current ? "bg-lime-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{date.getDate()}</p>
          <div className="space-y-1">{daySlots.map((slot, index) => { const cancelled = courses.find((course) => course.id === slot.courseId)?.cancellations?.some((item) => item.classDate === dateKey && item.startTime === slot.startTime); return <button className={`block w-full min-w-0 rounded border px-0.5 py-1 sm:px-1.5 text-left focus:outline-none focus:ring-2 ${cancelled ? "border-stone-300 bg-stone-100 hover:border-stone-400 focus:ring-stone-500" : "hover:border-lime-400 focus:ring-lime-600"} ${cancelled ? (inMonth ? "" : "opacity-60") : inMonth ? "border-lime-200 bg-lime-50" : "border-stone-200 bg-white/60 opacity-60"}`} key={`${date.toISOString()}-${slot.courseId}-${slot.startTime}-${index}`} onClick={() => { const course = courses.find(({ id }) => id === slot.courseId); if (course) setSelectedClass({ course, date, slot }); }} title={`${slot.courseName} · ${displayTime(slot.startTime)}–${displayTime(slot.endTime)}`} type="button"><span className="block truncate font-sans text-[9px] font-bold leading-3 text-slate-800">{slot.courseName}{cancelled ? " · Cancelled" : ""}</span><span className={`block truncate font-sans text-[8px] font-semibold leading-3 ${cancelled ? "text-stone-500" : "text-lime-700"}`}>{displayTime(slot.startTime)}–{displayTime(slot.endTime)}</span></button>; })}</div>
        </section>; })}</div>
      </div></div>}
    </section>
    <StudentBalancesWidget />
  </div></main>;
}
