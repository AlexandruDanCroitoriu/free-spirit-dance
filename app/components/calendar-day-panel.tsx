"use client";

import { useEffect, useRef, useState } from "react";
import { weekdays, type Course } from "../lib/courses";
import { type FreeEvent } from "../lib/free-events";
import { eventButton, eventInput, eventPrimary } from "../lib/practice-parties";
import { newSession, SessionFields, useEventSave } from "./practice-forms";
import TimeSelector from "./time-selector";

export default function CalendarDayPanel({ date, courses, onClose }: { date: string; courses: Course[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"practice" | "class" | "meeting">("practice");
  const [session, setSession] = useState(() => ({ ...newSession(), date }));
  const [courseId, setCourseId] = useState("");
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("20:00");
  const [rent, setRent] = useState("0");
  const [events, setEvents] = useState<FreeEvent[]>([]);
  const [eventsError, setEventsError] = useState("");
  const [eventId, setEventId] = useState("");
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [meeting, setMeeting] = useState(() => ({ name: "", ...newSession(), date, spaceRent: "0", acceptsDonations: false }));
  const practice = useEventSave("/api/practice-parties", onClose);
  const lesson = useEventSave("/api/classes", onClose);
  const meetingSave = useEventSave(eventId ? `/api/free-events/${eventId}/meetings` : "/api/free-events/0/meetings", onClose);
  const mutation = tab === "practice" ? practice : tab === "class" ? lesson : meetingSave;
  const busy = practice.busy || lesson.busy || meetingSave.busy;
  const locked = busy || practice.uncertain || lesson.uncertain || meetingSave.uncertain;
  const selectedEvent = events.find(item => item.id === Number(eventId));
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(date + "T12:00:00"));

  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo(0, window.scrollY))); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/free-events", { signal: controller.signal }).then(async response => {
      const body = await response.json() as FreeEvent[] | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error : "Could not load events.");
      if (!controller.signal.aborted) setEvents(body as FreeEvent[]);
    }).catch(reason => { if (!controller.signal.aborted) setEventsError(reason instanceof Error ? reason.message : "Could not load events."); });
    return () => controller.abort();
  }, []);

  return <dialog ref={dialog} aria-labelledby="calendar-day-title" className="fixed inset-0 m-0 box-border h-dvh max-h-none w-auto max-w-none overflow-y-auto border-0 bg-stone-50 p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60 md:inset-y-0 md:left-auto md:w-full md:max-w-xl" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => {
    if (busy || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <header className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white p-5"><div><h2 id="calendar-day-title" className="m-0 text-2xl">Add to calendar</h2><p className="mt-1 font-sans text-sm text-slate-500">{dateLabel}</p></div><button type="button" className={eventButton} disabled={busy} onClick={onClose}>Close</button></header>
    <div className="p-5">
      <div role="tablist" aria-label="Event type" className="mb-5 flex gap-5 border-b border-stone-200">{(["practice", "class", "meeting"] as const).map((value, index) => <button key={value} type="button" role="tab" id={`calendar-${value}-tab`} aria-controls={`calendar-${value}-form`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} disabled={locked} onClick={() => setTab(value)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const tabs = ["practice", "class", "meeting"] as const;
        const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(value) + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        setTab(next); document.getElementById(`calendar-${next}-tab`)?.focus();
      }} className={`border-b-2 px-1 py-3 font-sans text-sm font-semibold ${tab === value ? "border-lime-600 text-slate-800" : "border-transparent text-slate-500"}`}>{index === 0 ? "Practice party" : index === 1 ? "Course class" : "Event meeting"}</button>)}</div>
      <section role="tabpanel" id={`calendar-${tab}-form`} aria-labelledby={`calendar-${tab}-tab`}>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void (tab === "practice" ? practice.save({ action: "create", session }) : tab === "class" ? lesson.save({ courseId: Number(courseId), classDate: date, startTime, endTime, rentCostMinor: Math.round(Number(rent) * 100) }) : meetingSave.save({ action: "create", meeting })); }}>
          <fieldset disabled={locked} className="space-y-4 font-sans text-sm">
            {tab === "practice" ? <SessionFields value={session} onChange={setSession} dateReadOnly /> : tab === "class" ? <>
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
            </> : <>
              <div className="relative">
                <span id="event-picker-label" className="mb-1 block">Event</span>
                <button type="button" aria-labelledby="event-picker-label" aria-haspopup="listbox" aria-expanded={eventPickerOpen} aria-controls="event-picker-options" className={`${eventInput} flex items-center justify-between gap-3 text-left`} onClick={() => setEventPickerOpen(open => !open)}>
                  <span className="flex min-w-0 items-center gap-2">{selectedEvent ? <>{selectedEvent.imagePath ? <img src={selectedEvent.imagePath} alt="" className="h-8 w-10 shrink-0 rounded border border-stone-200 object-cover" /> : <span className="flex h-8 w-10 shrink-0 items-center justify-center rounded border border-dashed border-stone-300 bg-stone-50 text-[10px] text-slate-400">No image</span>}<span className="truncate">{selectedEvent.name}</span></> : "Choose an event"}</span>
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-4 w-4 shrink-0 transition-transform ${eventPickerOpen ? "rotate-180" : ""}`}><path d="m5 7 5 5 5-5" /></svg>
                </button>
                {eventPickerOpen && <div id="event-picker-options" role="listbox" aria-labelledby="event-picker-label" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-stone-300 bg-white p-1 shadow-lg">
                  {!events.length ? <p className="p-3 text-slate-500">No events available.</p> : events.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === Number(eventId)} className={`flex w-full items-center gap-3 rounded-md p-2 text-left font-sans text-sm hover:bg-lime-50 ${item.id === Number(eventId) ? "bg-lime-100 text-lime-950" : "text-slate-800"}`} onClick={() => { setEventId(String(item.id)); setEventPickerOpen(false); }}>
                    {item.imagePath ? <img src={item.imagePath} alt="" className="h-10 w-14 shrink-0 rounded border border-stone-200 object-cover" /> : <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded border border-dashed border-stone-300 bg-stone-50 text-xs text-slate-400">No image</span>}
                    <span className="truncate">{item.name}</span>
                  </button>)}
                </div>}
              </div>
              {eventsError ? <p role="alert" className="text-red-700">{eventsError}</p> : !events.length && <p className="text-slate-500">No events available. <a href="/free-events" className="underline">Create an event first.</a></p>}
              <p className="text-slate-500">Set up a meeting on {dateLabel}.</p>
              <label className="block">Meeting name<input required maxLength={160} className={eventInput} value={meeting.name} onChange={event => setMeeting({ ...meeting, name: event.target.value })} /></label>
              <SessionFields value={meeting} onChange={value => setMeeting({ ...meeting, ...value })} dateReadOnly />
              <label className="block">Space rent cost (RON)<input required inputMode="decimal" className={eventInput} value={meeting.spaceRent} onChange={event => setMeeting({ ...meeting, spaceRent: event.target.value })} /></label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={meeting.acceptsDonations} onChange={event => setMeeting({ ...meeting, acceptsDonations: event.target.checked })} />Can receive donations</label>
            </>}
          </fieldset>
          {mutation.error && <p role="alert" className="font-sans text-sm text-red-700">{mutation.error}</p>}
          <button type="submit" className={eventPrimary} disabled={busy || (tab === "class" && (!courseId || endTime <= startTime)) || (tab === "meeting" && !eventId)}>{busy ? "Saving…" : mutation.uncertain ? "Retry save" : tab === "practice" ? "Add practice party" : tab === "class" ? "Add class" : "Create meeting"}</button>
        </form>
      </section>
    </div>
  </dialog>;
}
