"use client";

import { useEffect, useState } from "react";
import type { CalendarClass } from "../lib/class-attendance";

type Entry = { id: number; action: string; field: string | null; oldValue: string | null; newValue: string | null; studentName: string | null; administratorEmail: string; administratorName: string | null; administratorPicture: string | null; createdAt: string };
const fields: Record<string, string> = { course: "Course", date: "Date", start_time: "Start time", end_time: "End time", rent_cost: "Rent cost", rent_paid: "Rent money given" };
function value(field: string | null, text: string | null) {
  if (text === null || text === "") return "Empty";
  if (field === "rent_cost") return `${(Number(text) / 100).toFixed(2)} RON`;
  if (field === "rent_paid") return text === "true" ? "Yes" : "No";
  return text;
}
function description(entry: Entry) {
  const student = entry.studentName ?? "Student";
  if (entry.action === "created") return "Created this class";
  if (entry.action === "cancelled") return "Cancelled this class";
  if (entry.action === "restored") return "Restored this class";
  if (entry.action === "attendance_added") return `Recorded attendance: ${student}`;
  if (entry.action === "attendance_removed") return `Removed attendance: ${student}`;
  if (entry.action === "free_attendance_added") return `Granted free attendance: ${student}`;
  if (entry.action === "free_attendance_removed") return `Removed free attendance: ${student}`;
  if (entry.action === "free_missed_added") return `Granted free missed attendance: ${student}`;
  if (entry.action === "free_missed_removed") return `Removed free missed attendance: ${student}`;
  return `${fields[entry.field ?? ""] ?? "Class detail"}: ${value(entry.field, entry.oldValue)} → ${value(entry.field, entry.newValue)}`;
}

export default function ClassChangeLog({ slot, revision }: { slot: CalendarClass; revision: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ courseId: String(slot.courseId), classDate: slot.classDate, startTime: slot.startTime });
    setEntries(null); setError("");
    fetch(`/api/class-attendance/history?${query}`, { signal: controller.signal }).then(async response => {
      const body = await response.json() as Entry[] | { error?: string };
      if (!response.ok || !Array.isArray(body)) throw new Error(!Array.isArray(body) ? body.error ?? "Could not load class history." : "Could not load class history.");
      if (!controller.signal.aborted) setEntries(body);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load class history."); });
    return () => controller.abort();
  }, [slot.courseId, slot.classDate, slot.startTime, revision, refresh]);
  return <section aria-labelledby="class-history-title" className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3"><h3 id="class-history-title" className="m-0 text-xl font-normal">Class history</h3><button type="button" onClick={() => setRefresh(value => value + 1)} className="rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">Refresh</button></div>
    {error ? <p role="alert" className="font-sans text-sm text-red-700">{error}</p> : !entries ? <p role="status" className="font-sans text-sm text-slate-500">Loading class history…</p> : entries.length === 0 ? <p className="font-sans text-sm text-slate-500">No class changes have been recorded yet. Earlier changes may be unavailable.</p> : <ol className="mt-4 list-none divide-y divide-stone-100 p-0">{entries.map(entry => {
      const name = entry.administratorName?.trim() || entry.administratorEmail;
      const initials = name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase();
      return <li key={entry.id} className="py-3 font-sans text-sm"><p className="m-0 text-slate-800">{description(entry)}</p><p className="mt-1 flex items-center gap-2 text-xs text-slate-500"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 text-[10px] font-semibold text-slate-800">{entry.administratorPicture && /^\/(?!\/)/.test(entry.administratorPicture) ? <img src={entry.administratorPicture} alt="" loading="lazy" className="h-full w-full object-cover" /> : initials}</span><span>{name} · {entry.createdAt === "1970-01-01T00:00:00Z" ? "Date unavailable" : <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>}</span></p></li>;
    })}</ol>}
  </section>;
}
