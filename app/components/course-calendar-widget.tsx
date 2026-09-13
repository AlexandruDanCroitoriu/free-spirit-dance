"use client";

import { type PracticeSession, sessionEnd } from "../lib/practice-parties";
import { readJson } from "../lib/http";
import { useEffect, useMemo, useRef, useState } from "react";
import CalendarDayPanel from "./calendar-day-panel";
import PracticePartyPanel from "./practice-party-panel";
import ClassAttendancePanel from "./class-attendance-panel";
import StudentPanel from "./student-panel";
import { schoolToday } from "../lib/student-activity";
import { weekdays, type Course } from "../lib/courses";

type ClassSlot = { startDate: string | null; endDate: string | null; courseId: number; courseName: string; day: string; startTime: string; endTime: string };
type SelectedClass = { course: Course; date: Date; slot: ClassSlot };
type ApiError = { error?: string };
type Student = { id: number; firstName: string; lastName: string; picture: string | null; active: boolean };
type StudentDay = { date: string; attendance: number; missed: number; payment: number };

const dayLabels: Record<string, string> = { Monday: "Luni", Tuesday: "Marți", Wednesday: "Miercuri", Thursday: "Joi", Friday: "Vineri", Saturday: "Sâmbătă", Sunday: "Duminică" };
const monthStorageKey = "fsd-calendar-month";
const viewStorageKey = "fsd-calendar-view";
const studentStorageKey = "fsd-calendar-student";

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

function studentDayLabel(day: StudentDay) {
  const attendance = day.attendance ? `${day.attendance} ${day.attendance === 1 ? "class" : "classes"} attended` : "";
  const missed = day.missed ? `${day.missed} ${day.missed === 1 ? "class" : "classes"} missed` : "";
  return [day.payment ? "Payment" : "", attendance, missed].filter(Boolean).join(" · ");
}

function studentDayColor(day: StudentDay) {
  return day.payment && day.attendance ? "border-teal-300 bg-teal-100 text-teal-900" : day.payment ? "border-blue-300 bg-blue-100 text-blue-900" : day.attendance ? "border-lime-300 bg-lime-100 text-lime-900" : "border-orange-300 bg-orange-100 text-orange-900";
}

export default function CourseCalendarWidget() {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedPractice, setSelectedPractice] = useState<number | null>(null);
  const [eventSessions, setEventSessions] = useState<PracticeSession[]>([]);
  const [canOpenEvents, setCanOpenEvents] = useState(false);
  const [eventError, setEventError] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [calendarReload, setCalendarReload] = useState(0);
  const [visibleMonth, setVisibleMonth] = useState(() => { const date = new Date(schoolToday() + "T12:00:00"); return new Date(date.getFullYear(), date.getMonth(), 1); });
  const [monthRestored, setMonthRestored] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedClass, setSelectedClass] = useState<SelectedClass | null>(null);
  const [calendarMode, setCalendarMode] = useState<"school" | "student">("school");
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [studentDays, setStudentDays] = useState<StudentDay[]>([]);
  const [studentPickerOpen, setStudentPickerOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState("");
  const studentSearchInput = useRef<HTMLInputElement>(null);
  const [openedAttendanceDate, setOpenedAttendanceDate] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(monthStorageKey);
      if (saved && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(saved)) {
        const [year, month] = saved.split("-").map(Number);
        setVisibleMonth(new Date(year, month - 1, 1));
      }
      const savedView = window.localStorage.getItem(viewStorageKey);
      if (savedView === "school" || savedView === "student") setCalendarMode(savedView);
      const savedStudent = Number(window.localStorage.getItem(studentStorageKey));
      if (Number.isInteger(savedStudent) && savedStudent > 0) setSelectedStudentId(savedStudent);
    } catch { /* Keep the current month when browser storage is unavailable. */ }
    setMonthRestored(true);
  }, []);

  useEffect(() => {
    if (!monthRestored) return;
    try {
      window.localStorage.setItem(monthStorageKey, `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`);
    } catch { /* Calendar navigation still works without browser storage. */ }
  }, [visibleMonth, monthRestored]);

  useEffect(() => {
    if (!monthRestored) return;
    try {
      window.localStorage.setItem(viewStorageKey, calendarMode);
      if (selectedStudentId !== null) window.localStorage.setItem(studentStorageKey, String(selectedStudentId));
      else window.localStorage.removeItem(studentStorageKey);
    } catch { /* Selection still works without browser storage. */ }
  }, [calendarMode, selectedStudentId, monthRestored]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch("/api/calendar", { signal: controller.signal }).then(async (response) => {
      const data = await readJson<Course[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load the course calendar.");
      if (!controller.signal.aborted) setCourses(data);
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the course calendar."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [calendarReload]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/students", { signal: controller.signal }).then(async response => {
      const data = await readJson<Student[] | ApiError>(response);
      if (!response.ok || !Array.isArray(data)) throw new Error(!Array.isArray(data) && data.error ? data.error : "Could not load students.");
      if (!controller.signal.aborted) setStudents(data.filter(student => student.active).sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)));
    }).catch(() => { /* School calendar remains available if the directory is unavailable. */ });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const refresh = () => setCalendarReload((value) => value + 1);
    window.addEventListener("calendar-updated", refresh);
    return () => window.removeEventListener("calendar-updated", refresh);
  }, []);

  const today = useMemo(() => new Date(schoolToday() + "T12:00:00"), []);
  const firstDayOffset = (visibleMonth.getDay() + 6) % 7;
  const gridStart = addDays(visibleMonth, -firstDayOffset);
  const calendarDates = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const from = calendarDates[0].getFullYear() + '-' + String(calendarDates[0].getMonth() + 1).padStart(2, '0') + '-' + String(calendarDates[0].getDate()).padStart(2, '0');
  const last = calendarDates[41];
  const to = last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0') + '-' + String(last.getDate()).padStart(2, '0');
  useEffect(() => {
    const controller = new AbortController(); setEventError('');
    fetch(`/api/practice-calendar?from=${from}&to=${to}`, { signal: controller.signal }).then(async response => {
      const body = await response.json() as { sessions: PracticeSession[]; canOpen: boolean; error?: string }; if (!response.ok) throw new Error(body.error ?? 'Could not load events.');
      if (!controller.signal.aborted) { setEventSessions(body.sessions); setCanOpenEvents(body.canOpen); }
    }).catch(e => { if (!controller.signal.aborted) setEventError(e.message); });
    return () => controller.abort();
  }, [from, to, calendarReload]);
  useEffect(() => {
    if (calendarMode !== "student" || selectedStudentId === null) { setStudentDays([]); return; }
    const controller = new AbortController();
    fetch(`/api/student-calendar?studentId=${selectedStudentId}&from=${from}&to=${to}`, { signal: controller.signal }).then(async response => {
      const body = await readJson<{ events: StudentDay[] } | ApiError>(response);
      if (!response.ok || !("events" in body)) throw new Error("Could not load student calendar.");
      if (!controller.signal.aborted) setStudentDays(body.events);
    }).catch(() => { if (!controller.signal.aborted) setStudentDays([]); });
    return () => controller.abort();
  }, [calendarMode, selectedStudentId, from, to]);
  const slots = courses.flatMap<ClassSlot>((course) =>
    course.schedules.map((schedule) => ({ courseId: course.id, courseName: course.name, startDate: course.startDate, endDate: course.endDate, ...schedule }))
  ).sort((first, second) => first.startTime.localeCompare(second.startTime) || first.courseName.localeCompare(second.courseName));
  const monthLabel = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(visibleMonth);
  const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en", { month: "long" }).format(new Date(2000, month, 1)));
  const courseYears = courses.flatMap((course) => [course.startDate, course.endDate, ...(course.occurrences ?? []).map((occurrence) => occurrence.classDate)])
    .filter((date): date is string => Boolean(date)).map((date) => Number(date.slice(0, 4)));
  const firstYear = Math.min(2024, today.getFullYear(), visibleMonth.getFullYear(), ...courseYears);
  const lastYear = Math.max(today.getFullYear() + 5, visibleMonth.getFullYear(), ...courseYears);
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
  const selectedStudent = students.find(student => student.id === selectedStudentId) ?? null;
  const filteredStudents = students.filter((student) => `${student.firstName} ${student.lastName}`.toLocaleLowerCase().includes(studentSearch.trim().toLocaleLowerCase()));
  function changeMonth(amount: number) { setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1)); }

  return <>
    {selectedDay && <CalendarDayPanel date={selectedDay} courses={courses} onClose={() => setSelectedDay(null)} />}
    {selectedPractice !== null && <PracticePartyPanel id={selectedPractice} onClose={() => { setSelectedPractice(null); setCalendarReload(v => v + 1); }} />}
    {selectedClass && <ClassAttendancePanel courseName={selectedClass.course.name} slot={{ courseId: selectedClass.slot.courseId, classDate: `${selectedClass.date.getFullYear()}-${String(selectedClass.date.getMonth() + 1).padStart(2, "0")}-${String(selectedClass.date.getDate()).padStart(2, "0")}`, startTime: selectedClass.slot.startTime }} onClose={() => setSelectedClass(null)} />}
    {selectedStudentId !== null && openedAttendanceDate && <StudentPanel key={`calendar-attendance-${selectedStudentId}-${openedAttendanceDate}`} id={selectedStudentId} attendanceDate={openedAttendanceDate} onClose={() => setOpenedAttendanceDate(null)} onUpdate={() => {}} onDelete={() => setOpenedAttendanceDate(null)} />}
    <section className="min-w-0 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm" aria-labelledby="calendar-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 font-sans text-xs"><h2 className="sr-only" id="calendar-title">Calendar</h2>
          <label className="font-semibold text-slate-700" htmlFor="calendar-view">View</label>
          <select id="calendar-view" className="h-8 rounded-md border border-stone-300 bg-white px-2 font-semibold text-slate-700 focus:ring-2 focus:ring-lime-600" value={calendarMode} onChange={event => { setCalendarMode(event.target.value as "school" | "student"); setSelectedDay(null); setSelectedClass(null); }}><option value="school">School calendar</option><option value="student">Student</option></select>
          {calendarMode === "student" && <div className="relative"><button type="button" aria-haspopup="listbox" aria-expanded={studentPickerOpen} className="flex h-8 min-w-52 items-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-left font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-lime-600" onClick={() => setStudentPickerOpen(open => { const next = !open; if (next) { setStudentSearch(""); window.setTimeout(() => studentSearchInput.current?.focus(), 0); } return next; })}>{selectedStudent?.picture ? <img className="h-5 w-5 rounded-full object-cover" alt="" src={selectedStudent.picture} /> : <span className="flex h-5 w-5 items-center justify-center rounded-full bg-lime-100 text-[9px] text-lime-800">{selectedStudent?.firstName.slice(0, 1) ?? "?"}</span>}<span className="flex-1 truncate">{selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Choose a student…"}</span><span aria-hidden="true">⌄</span></button>{studentPickerOpen && <div role="listbox" aria-label="Students" className="absolute z-30 mt-1 w-64 rounded-md border border-stone-300 bg-white p-1 shadow-lg"><input ref={studentSearchInput} type="search" aria-label="Filter students" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Type a student name…" className="mb-1 w-full rounded border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-lime-600 focus:ring-1 focus:ring-lime-600" /> <div className="max-h-56 overflow-y-auto">{filteredStudents.map(student => <button role="option" aria-selected={student.id === selectedStudentId} type="button" key={student.id} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-lime-50 focus:bg-lime-50 focus:outline-none" onClick={() => { setSelectedStudentId(student.id); setStudentPickerOpen(false); setStudentSearch(""); }}>{student.picture ? <img className="h-7 w-7 rounded-full object-cover" alt="" src={student.picture} /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lime-100 text-[10px] font-bold text-lime-800">{student.firstName.slice(0, 1)}</span>}<span>{student.firstName} {student.lastName}</span></button>)}{filteredStudents.length === 0 && <p className="px-2 py-3 text-sm text-slate-500">No students found.</p>}</div></div>}</div>}
        </div>
        <div className="flex items-center gap-1.5 font-sans">
          <button type="button" aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(-1)}>‹</button>
          <select aria-label="Calendar month" className="h-8 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-lime-600" value={visibleMonth.getMonth()} onChange={(event) => { const month = Number(event.target.value); setVisibleMonth((current) => new Date(current.getFullYear(), month, 1)); }}>
            {months.map((month, index) => <option key={month} value={index}>{month}</option>)}
          </select>
          <select aria-label="Calendar year" className="h-8 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-lime-600" value={visibleMonth.getFullYear()} onChange={(event) => { const year = Number(event.target.value); setVisibleMonth((current) => new Date(year, current.getMonth(), 1)); }}>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <span className="sr-only" aria-live="polite">{monthLabel}</span>
          <button type="button" aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-50" onClick={() => changeMonth(1)}>›</button>
        </div>
      </div>
      {eventError && <p role="alert" className="p-3 text-sm text-red-700">{eventError} <button onClick={() => setCalendarReload(v => v + 1)}>Retry</button></p>}
      {loading ? <p className="p-8 text-center font-sans text-xs text-slate-400">Loading calendar...</p> : error ? <p className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 font-sans text-xs text-red-700" role="alert">{error}</p> : <div className="min-w-0"><div className="calendar-widget-body">
        <div className="calendar-grid border-b border-stone-200 bg-stone-50">{weekdays.map((day) => <div className="px-1 py-2 text-center font-sans text-[10px] font-bold uppercase tracking-wider text-slate-400" key={day}>{dayLabels[day].slice(0, 3)}</div>)}</div>
        <div className="calendar-grid border-l border-stone-200">{calendarDates.map((date) => { const day = weekdays[(date.getDay() + 6) % 7]; const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; const studentDay = studentDays.find(item => item.date === dateKey); const daySlots = calendarMode === "school" ? slots.filter((slot) => dateKey >= schoolToday() && slot.day === day && (!slot.startDate || dateKey >= slot.startDate) && (!slot.endDate || dateKey <= slot.endDate)) : []; for (const course of calendarMode === "school" ? courses : []) for (const occurrence of course.occurrences ?? []) {
          if (occurrence.classDate !== dateKey) continue;
          const existing = daySlots.findIndex((slot) => slot.courseId === course.id && slot.startTime === occurrence.startTime);
          const recorded = { courseId: course.id, courseName: course.name, day, startTime: occurrence.startTime, endTime: occurrence.endTime ?? "", startDate: course.startDate, endDate: course.endDate };
          if (existing >= 0) daySlots[existing] = recorded; else daySlots.push(recorded);
        }
        daySlots.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.courseName.localeCompare(b.courseName));
        const dayPractices = calendarMode === "school" ? eventSessions.filter(s => s.startsAt.slice(0, 10) === dateKey) : [];
        const empty = calendarMode === "school" && daySlots.length === 0 && dayPractices.length === 0;
        const current = sameDate(date, today); const inMonth = date.getMonth() === visibleMonth.getMonth(); return <section className={`calendar-widget-day relative border-b border-r border-stone-200 p-0.5 sm:p-1.5 ${current ? "bg-lime-50/70" : inMonth ? "bg-white" : "bg-stone-50/70"}`} key={date.toISOString()} aria-label={date.toLocaleDateString()}>
          {empty && <button type="button" aria-label={`Add event on ${dateKey}`} onClick={() => setSelectedDay(dateKey)} className="absolute inset-0 z-10 rounded-sm hover:bg-lime-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-lime-600" />}
          <p className={`mb-1 flex h-5 w-5 items-center justify-center rounded-full font-sans text-[10px] font-semibold ${current ? "bg-lime-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"}`}>{date.getDate()}</p>
          <div className="space-y-1">{calendarMode === "student" && selectedStudentId !== null && studentDay && (studentDay.attendance > 0 ? <button type="button" onClick={() => setOpenedAttendanceDate(dateKey)} className={`block w-full rounded border p-1 text-left font-sans text-[9px] font-bold transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-lime-600 ${studentDayColor(studentDay)}`} title="Open this attendance in the student log">{studentDayLabel(studentDay)}</button> : <div className={`rounded border p-1 font-sans text-[9px] font-bold ${studentDayColor(studentDay)}`}>{studentDayLabel(studentDay)}</div>)}{dayPractices.map(s => <button type="button" key={`practice-${s.id}`} disabled={!canOpenEvents} onClick={() => setSelectedPractice(s.id)} className={`block w-full rounded border border-pink-200 bg-pink-50 p-1 text-left font-sans text-[9px] ${s.cancelled ? 'opacity-50' : ''}`} title={`Practice party · ${s.startsAt.slice(11)}–${sessionEnd(s).slice(11)}`}><span className="block truncate font-bold">Practice party{s.cancelled ? ' · Cancelled' : ''}</span><span>{s.startsAt.slice(11)}</span></button>)}{daySlots.map((slot, index) => { const cancelled = courses.find((course) => course.id === slot.courseId)?.cancellations?.some((item) => item.classDate === dateKey && item.startTime === slot.startTime); return <button className={`block w-full min-w-0 rounded border px-0.5 py-1 sm:px-1.5 text-left focus:outline-none focus:ring-2 ${cancelled ? "border-stone-300 bg-stone-100 hover:border-stone-400 focus:ring-stone-500" : "hover:border-lime-400 focus:ring-lime-600"} ${cancelled ? (inMonth ? "" : "opacity-60") : inMonth ? "border-lime-200 bg-lime-50" : "border-stone-200 bg-white/60 opacity-60"}`} key={`${date.toISOString()}-${slot.courseId}-${slot.startTime}-${index}`} onClick={() => { const course = courses.find(({ id }) => id === slot.courseId); if (course) setSelectedClass({ course, date, slot }); }} title={`${slot.courseName} · ${displayTime(slot.startTime)}–${displayTime(slot.endTime)}`} type="button"><span className="block truncate font-sans text-[9px] font-bold leading-3 text-slate-800">{slot.courseName}{cancelled ? " · Cancelled" : ""}</span><span className={`block truncate font-sans text-[8px] font-semibold leading-3 ${cancelled ? "text-stone-500" : "text-lime-700"}`}>{displayTime(slot.startTime)}–{displayTime(slot.endTime)}</span></button>; })}</div>
        </section>; })}</div>
      </div></div>}
    </section>
  </>;
}
