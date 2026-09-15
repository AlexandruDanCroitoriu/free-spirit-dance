"use client";
import { useEffect, useState } from "react";
declare global { interface Window { __fsdGeneration?: number } }
export default function ProductionDatabaseBanner() {
  const [status, setStatus] = useState<{ available: boolean; local?: boolean; readOnly?: boolean; active: string; generation: number; maintenance: boolean; name: string } | null>(null);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/production-database", { cache: "no-store" });
        if (response.ok && !stopped) setStatus(await response.json());
      } catch { /* Existing content remains visible during transient failures. */ }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 5000);
    window.addEventListener("focus", refresh);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  if (!status?.available) return null;
  const changed = window.__fsdGeneration !== undefined && window.__fsdGeneration !== status.generation;
  if (!changed && !status.maintenance && !status.readOnly && !status.local) return null;
  return <div role="status" className="sticky top-0 z-30 border-b border-amber-300 bg-amber-100 px-6 py-3 font-sans text-sm text-amber-950">
    {status.readOnly && <p className="m-0"><strong>Read-only backup preview — this is not production.</strong> You are viewing a copy: <strong>{status.name}</strong>. Changes cannot be saved and will not affect production.</p>}
    {status.maintenance ? <p className="m-0">Database maintenance is in progress. Please wait before making changes.</p> : changed ? <p className="m-0">The database view has changed. Reload to view the selected database. Unsaved changes will be lost on reload.</p> : !status.readOnly && status.local && <>Local backup test copy: <strong>{status.name}</strong>.</>}
    {changed && <button className="ml-3 rounded border border-amber-700 px-3 py-1 font-semibold" onClick={() => window.location.reload()}>Reload page</button>}
  </div>;
}
