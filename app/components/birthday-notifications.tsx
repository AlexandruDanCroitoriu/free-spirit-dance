"use client";

import { useEffect, useRef, useState } from "react";
import { addCalendarDays, nextBirthday } from "../lib/task-dates";
import { schoolToday } from "../lib/tasks";

type Student = { id: number; firstName: string; lastName: string; birthDate: string | null; active: boolean };
type Birthday = Student & { date: string };

function upcomingBirthdays(students: Student[], today: string) {
  const end = addCalendarDays(today, 30);
  return students.flatMap((student): Birthday[] => {
    const date = student.active && student.birthDate ? nextBirthday(student.birthDate, today) : null;
    return date && date <= end ? [{ ...student, date }] : [];
  }).sort((first, second) => first.date.localeCompare(second.date) || first.lastName.localeCompare(second.lastName));
}

const dateFormatter = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: 'UTC' });

export default function BirthdayNotifications() {
  const [students, setStudents] = useState<Student[]>([]);
  const [today, setToday] = useState(schoolToday);
  const birthdays = upcomingBirthdays(students, today);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const dropdown = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/students", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load birthdays.");
        const students = await response.json() as Student[];
        if (!Array.isArray(students)) throw new Error("Could not load birthdays.");
        if (!controller.signal.aborted) setStudents(students);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => { const timer = window.setInterval(() => setToday(schoolToday()), 60_000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdown.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);

  const label = !loaded ? "Loading birthday notifications" : birthdays.length ? `${birthdays.length} upcoming ${birthdays.length === 1 ? "birthday" : "birthdays"}` : "No birthdays in the next 30 days";
  return <div ref={dropdown} className="relative shrink-0 font-sans" onBlur={(event) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" aria-label={label} aria-expanded={open} aria-controls="birthday-notifications" onClick={() => setOpen((current) => !current)} className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-slate-700 hover:bg-stone-50 focus-visible:outline-lime-600">
      <svg aria-hidden="true" className="h-5 w-5 fill-none stroke-current stroke-2" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
      {loaded && birthdays.length > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">{birthdays.length > 99 ? "99+" : birthdays.length}</span>}
    </button>
    {open && <div id="birthday-notifications" role="dialog" aria-label="Upcoming birthdays" className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
      <div className="border-b border-stone-200 px-4 py-3"><h2 className="m-0 text-sm font-semibold text-slate-800">Upcoming birthdays</h2><p className="m-0 mt-0.5 text-xs text-slate-500">Next 30 days</p></div>
      {error ? <p role="alert" className="m-0 p-4 text-sm text-red-700">Could not load birthdays.</p> : !loaded ? <p role="status" className="m-0 p-4 text-sm text-slate-500">Loading birthdays…</p> : birthdays.length === 0 ? <p className="m-0 p-4 text-sm text-slate-500">No student birthdays in the next 30 days.</p> : <ul className="m-0 max-h-72 list-none divide-y divide-stone-100 overflow-y-auto p-0">{birthdays.map((student) => <li key={student.id}><a href={`/students/${student.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-stone-50 focus-visible:outline-lime-600"><span className="min-w-0 truncate font-medium text-slate-800">{student.firstName} {student.lastName}</span><time dateTime={student.date} className="shrink-0 text-xs font-semibold text-lime-800">{dateFormatter.format(new Date(`${student.date}T12:00:00Z`))}</time></a></li>)}</ul>}
    </div>}
  </div>;
}
