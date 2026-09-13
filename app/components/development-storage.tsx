"use client";

import { useEffect, useState } from "react";
import { type LocalCopy } from "../lib/local-copies";

export default function DevelopmentStorage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [copies, setCopies] = useState<LocalCopy[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = () => fetch("/api/development-storage", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json() as Promise<{ available?: boolean; selected: string; copies: LocalCopy[] }>)
      .then((data) => { if (data.available) { setSelected(data.selected); setCopies(data.copies ?? []); } })
      .catch(() => {});
    void load();
    window.addEventListener("local-databases-updated", load);
    // Reload restored pages and other tabs so old records cannot be saved to a new store.
    const refresh = () => window.location.reload();
    const onStorage = (event: StorageEvent) => { if (event.key === "fsd-storage-changed") refresh(); if (event.key === "fsd-copy-names-changed") void load(); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      controller.abort();
      window.removeEventListener("local-databases-updated", load);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  async function change(next: string) {
    if (next === selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/development-storage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected: next }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "Could not switch storage. Try again.");
      }
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
    <button type="button" aria-pressed={selected === "catalog"} disabled={busy} className={`w-full rounded px-2 py-2 font-semibold disabled:opacity-50 ${selected === "catalog" ? "bg-lime-300 text-slate-900" : "bg-slate-800 text-slate-300"}`} onClick={() => void change("catalog")}>Catalog</button>
    <label className="mt-2 block text-slate-400">Local development copy<select aria-label="Development database" disabled={busy} value={selected} onChange={(event) => void change(event.currentTarget.value)} className="mt-1 w-full rounded border border-slate-600 bg-slate-800 px-2 py-2 font-sans text-xs font-semibold text-slate-100 disabled:opacity-50"><option value="catalog">Catalog</option>{copies.map(copy => <option key={copy.id} value={copy.id}>{copy.name}</option>)}</select></label>
    <p className="mt-2 text-slate-400">{selected !== "catalog" ? "Local production copy. Changes stay on this computer." : "Imported catalog. Changes stay on this computer."}</p>
    {error && <p className="mt-2 text-orange-300" role="alert">{error}</p>}
  </div>;
}
