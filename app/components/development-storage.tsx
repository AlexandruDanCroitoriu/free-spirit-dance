"use client";

import { useEffect, useState } from "react";

export default function DevelopmentStorage() {
  const [selected, setSelected] = useState<"local" | "production" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/development-storage", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json() as Promise<{ available?: boolean; selected: "local" | "production" }>)
      .then((data) => { if (data.available) setSelected(data.selected); })
      .catch(() => {});
    // Reload restored pages and other tabs so old records cannot be saved to a new store.
    const refresh = () => window.location.reload();
    const onStorage = (event: StorageEvent) => { if (event.key === "fsd-storage-changed") refresh(); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      controller.abort();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  async function change(next: "local" | "production") {
    if (next === selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/development-storage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected: next }),
      });
      if (!response.ok) throw new Error("Could not switch storage. Try again.");
      try { localStorage.setItem("fsd-storage-changed", String(Date.now())); } catch {}
      // Reload the current URL after the storage-selection cookie is updated.
      // This preserves the page, filters, and anchors the administrator was using.
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not switch storage.");
      setBusy(false);
    }
  }

  if (!selected) return null;
  return <div className="my-4 rounded-lg border border-slate-700 p-3 text-xs">
    <p className="mb-2 font-semibold text-slate-300">Development database</p>
    <div aria-label="Development database" className="flex gap-1" role="group">
      {(["local", "production"] as const).map((value) => <button
        aria-pressed={selected === value} disabled={busy} key={value}
        className={`flex-1 rounded px-2 py-2 font-semibold disabled:opacity-50 ${selected === value ? value === "production" ? "bg-orange-300 text-slate-900" : "bg-lime-300 text-slate-900" : "bg-slate-800 text-slate-300"}`}
        onClick={() => void change(value)}
      >{value === "local" ? "Local" : "Production"}</button>)}
    </div>
    <p className="mt-2 text-slate-400">{selected === "production" ? "Changes affect live school data." : "Local test data and images."}</p>
    {error && <p className="mt-2 text-orange-300" role="alert">{error}</p>}
  </div>;
}
