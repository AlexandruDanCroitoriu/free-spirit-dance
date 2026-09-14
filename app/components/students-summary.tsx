"use client";

import { useEffect, useState } from "react";
import { readJson } from "../lib/http";

type Summary = { students: number; active: number; inactive: number; classAttendance: number; practiceAttendance: number };

export default function StudentsSummary({ students }: { students: readonly unknown[] }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("student-activity-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("student-activity-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch("/api/students/summary", { signal: controller.signal }).then(async (response) => {
      const data = await readJson<Summary | { error: string }>(response);
      if (!response.ok || !("students" in data)) throw new Error("Could not load student totals.");
      if (!controller.signal.aborted) setSummary(data);
    }).catch(() => {
      if (!controller.signal.aborted) { setSummary(null); setError(true); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [students, revision]);

  const metrics = [
    { label: "All students", value: summary?.students, detail: "Entire directory" },
    { label: "Active students", value: summary?.active, detail: "Currently active" },
    { label: "Inactive students", value: summary?.inactive, detail: "Currently inactive" },
    { label: "All attendances", value: summary ? summary.classAttendance + summary.practiceAttendance : undefined, detail: summary ? `${summary.classAttendance.toLocaleString()} classes · ${summary.practiceAttendance.toLocaleString()} practice parties` : "Classes and practice parties" },
  ];

  return <section aria-label="Student totals" aria-busy={loading} className="mb-6 overflow-hidden rounded-xl border border-stone-200 bg-white font-sans">
    <dl className="m-0 grid grid-cols-2 gap-px bg-stone-200 sm:grid-cols-4">
      {metrics.map(({ label, value, detail }) => <div key={label} className="bg-white p-4 md:p-5">
        <dt className="text-xs font-semibold text-slate-500">{label}</dt>
        <dd className="m-0 mt-2 text-3xl font-semibold tabular-nums text-slate-800">{loading ? <span aria-label="Loading">…</span> : value?.toLocaleString() ?? "—"}</dd>
        <dd className="m-0 mt-1 text-xs text-slate-500">{detail}</dd>
      </div>)}
    </dl>
    {error && <p role="alert" className="m-0 border-t border-stone-200 px-4 py-3 text-xs text-red-700">Could not load student totals. <button type="button" onClick={() => setRevision((value) => value + 1)} className="font-semibold underline">Retry</button></p>}
  </section>;
}
