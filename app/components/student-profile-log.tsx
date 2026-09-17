"use client";

import { useEffect, useState } from "react";
import { profileFields, type ProfileField } from "../lib/student-profile-log";

type Entry = { id: number; action: "created" | "changed" | "course_added" | "course_removed"; field: ProfileField | null; oldValue: string | null; newValue: string | null; administratorEmail: string; administratorName: string | null; administratorPicture: string | null; createdAt: string };

const historicalImportEmail = "historical-import@free-spirit-dance.invalid";

function actorName(entry: Entry) {
  return entry.administratorEmail === historicalImportEmail ? "Imported from historical records" : entry.administratorName?.trim() || entry.administratorEmail;
}

function ActorAvatar({ entry }: { entry: Entry }) {
  const name = actorName(entry);
  const initials = entry.administratorEmail === historicalImportEmail ? "H" : name.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase();
  return <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime-200 text-[10px] font-semibold text-slate-800">
    {entry.administratorPicture && /^\/(?!\/)/.test(entry.administratorPicture) ? <img src={entry.administratorPicture} alt="" loading="lazy" className="h-full w-full object-cover" /> : initials}
  </span>;
}

function description(entry: Entry) {
  if (entry.action === "created" && entry.administratorEmail === historicalImportEmail) return "History import";
  if (entry.action === "created") return "Registered this student";
  if (entry.action === "course_added") return `Assigned course: ${entry.newValue}`;
  if (entry.action === "course_removed") return `Removed course: ${entry.newValue}`;
  const label = entry.field && profileFields[entry.field] ? profileFields[entry.field] : "Profile";
  return `${label}: ${entry.oldValue ?? "Empty"} → ${entry.newValue ?? "Empty"}`;
}

export default function StudentProfileLog({ studentId }: { studentId: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/students/${studentId}/profile-log`, { signal: controller.signal }).then(async response => {
      const body = await response.json() as Entry[] | { error?: string };
      if (!response.ok || !Array.isArray(body)) throw new Error(!Array.isArray(body) ? body.error ?? "Could not load profile history." : "Could not load profile history.");
      if (!controller.signal.aborted) setEntries(body);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load profile history."); });
    return () => controller.abort();
  }, [studentId, retry]);
  return <section aria-labelledby="profile-history-title" className="mt-6 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between gap-3"><h2 id="profile-history-title" className="m-0 text-xl font-normal">Profile history</h2><button type="button" onClick={() => { setEntries(null); setError(""); setRetry(value => value + 1); }} className="rounded-md border border-stone-300 px-3 py-2 font-sans text-xs font-semibold">Refresh</button></div>
    {error ? <p role="alert" className="font-sans text-sm text-red-700">{error}</p> : !entries ? <p role="status" className="font-sans text-sm text-slate-500">Loading profile history…</p> : entries.length === 0 ? <p className="font-sans text-sm text-slate-500">No profile changes have been recorded yet. Changes made before profile history was added are unavailable.</p> : <ol className="mt-4 list-none divide-y divide-stone-100 p-0">{entries.map(entry => <li key={entry.id} className="py-3 font-sans text-sm"><p className="m-0 text-slate-800">{description(entry)}</p><p className="mt-1 flex items-center gap-2 text-xs text-slate-500"><ActorAvatar entry={entry} /><span>{actorName(entry)} · {entry.createdAt === "1970-01-01T00:00:00Z" ? "Import date unavailable" : <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>}</span></p></li>)}</ol>}
  </section>;
}
