"use client";

import { useEffect, useRef, useState } from "react";
import { weekdays, type Course } from "../lib/courses";
import { eventButton, eventInput, eventPrimary } from "../lib/practice-parties";
import { newSession, SessionFields, useEventSave } from "./practice-forms";
import TimeSelector from "./time-selector";

export default function CalendarDayPanel({ date, courses, onClose }: { date: string; courses: Course[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"practice" | "class">("practice");
  const [session, setSession] = useState(() => ({ ...newSession(), date }));
  const [courseId, setCourseId] = useState("");
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("20:00");
  const [rent, setRent] = useState("0");
  const practice = useEventSave("/api/practice-parties", onClose);
  const lesson = useEventSave("/api/classes", onClose);
  const mutation = tab === "practice" ? practice : lesson;
  const busy = practice.busy || lesson.busy;
  const locked = busy || practice.uncertain || lesson.uncertain;
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(date + "T12:00:00"));

  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; };
  }, []);

  return <dialog ref={dialog} aria-labelledby="calendar-day-title" className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-xl overflow-y-auto border-0 bg-stone-50 p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => {
    if (busy || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <header className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white p-5"><div><h2 id="calendar-day-title" className="m-0 text-2xl">Add to calendar</h2><p className="mt-1 font-sans text-sm text-slate-500">{dateLabel}</p></div><button type="button" className={eventButton} disabled={busy} onClick={onClose}>Close</button></header>
    <div className="p-5">
      <div role="tablist" aria-label="Event type" className="mb-5 flex gap-5 border-b border-stone-200">{(["practice", "class"] as const).map((value, index) => <button key={value} type="button" role="tab" id={`calendar-${value}-tab`} aria-controls={`calendar-${value}-form`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} disabled={locked} onClick={() => setTab(value)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "practice" : event.key === "End" ? "class" : value === "practice" ? "class" : "practice";
        setTab(next); document.getElementById(`calendar-${next}-tab`)?.focus();
      }} className={`border-b-2 px-1 py-3 font-sans text-sm font-semibold ${tab === value ? "border-lime-600 text-slate-800" : "border-transparent text-slate-500"}`}>{index === 0 ? "Practice party" : "Course class"}</button>)}</div>
      <section role="tabpanel" id={`calendar-${tab}-form`} aria-labelledby={`calendar-${tab}-tab`}>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void (tab === "practice" ? practice.save({ action: "create", session }) : lesson.save({ courseId: Number(courseId), classDate: date, startTime, endTime, rentCostMinor: Math.round(Number(rent) * 100) })); }}>
          <fieldset disabled={locked} className="space-y-4 font-sans text-sm">
            {tab === "practice" ? <SessionFields value={session} onChange={setSession} dateReadOnly /> : <>
              <label className="block">Course<select required className={eventInput} value={courseId} onChange={event => {
                setCourseId(event.target.value);
                const schedules = courses.find(course => course.id === Number(event.target.value))?.schedules ?? [];
                const weekday = weekdays[(new Date(date + "T12:00:00").getDay() + 6) % 7];
                const schedule = schedules.find(item => item.day === weekday) ?? schedules[0];
                setStartTime(schedule?.startTime ?? "19:00");
                setEndTime(schedule?.endTime ?? "20:00");
                setRent(String((schedule?.rentCostMinor ?? 0) / 100));
              }}><option value="">Choose a course</option>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
              {!courses.length && <p>No courses available. <a href="/courses" className="underline">Create a course first.</a></p>}
              <p className="text-slate-500">Add a one-off class on {dateLabel}.</p>
              <div className="grid gap-3 sm:grid-cols-2"><TimeSelector label="Start time (Bucharest)" value={startTime} onChange={setStartTime} /><TimeSelector label="End time (Bucharest)" value={endTime} onChange={setEndTime} /></div>
              {endTime <= startTime && <p role="alert" className="text-red-700">End time must be after start time.</p>}
              <label className="block">Rent cost (RON)<input required type="number" min="0" max="999999.99" step="0.01" className={eventInput} value={rent} onChange={event => setRent(event.target.value)} /></label>
            </>}
          </fieldset>
          {mutation.error && <p role="alert" className="font-sans text-sm text-red-700">{mutation.error}</p>}
          <button type="submit" className={eventPrimary} disabled={busy || (tab === "class" && (!courseId || endTime <= startTime))}>{busy ? "Saving…" : mutation.uncertain ? "Retry save" : tab === "practice" ? "Add practice party" : "Add class"}</button>
        </form>
      </section>
    </div>
  </dialog>;
}
