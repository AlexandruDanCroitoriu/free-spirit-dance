"use client";
import { useEffect, useRef, useState } from "react";
import { type LocalCopy } from "../lib/local-copies";
import { readJson } from "../lib/http";
import ConfirmationDialog from "./confirmation-dialog";

const button = "rounded-lg bg-slate-900 px-4 py-2.5 font-sans text-sm font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 disabled:cursor-not-allowed disabled:opacity-50";
const settingsButton = "cursor-pointer list-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 [&::-webkit-details-marker]:hidden";
export default function LocalDatabaseManager() {
  const [copies, setCopies] = useState<LocalCopy[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [catalogCopyToConfirm, setCatalogCopyToConfirm] = useState<LocalCopy | null>(null);
  const [productionUploadToConfirm, setProductionUploadToConfirm] = useState<string | null>(null);
  const [copyDeletionToConfirm, setCopyDeletionToConfirm] = useState<LocalCopy | null>(null);
  const renameTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const savedDatabases = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false;
    const refresh = () => { void fetch("/api/development-storage", { cache: "no-store" }).then(readJson<{ available: boolean; selected: string; copies: LocalCopy[] }>).then(data => { if (!stopped && data.available) { setSelected(data.selected); setCopies(data.copies); } }).catch(() => {}); };
    refresh();
    window.addEventListener('local-databases-updated', refresh);
    return () => { stopped = true; window.removeEventListener('local-databases-updated', refresh); };
  }, []);
  useEffect(() => () => { renameTimers.current.forEach(clearTimeout); }, []);
  useEffect(() => {
    const closeSettingsOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const clickedSettings = target.closest("details");
      savedDatabases.current?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((settings) => {
        if (settings !== clickedSettings && !settings.contains(target)) settings.open = false;
      });
    };
    window.addEventListener("pointerdown", closeSettingsOutside);
    return () => window.removeEventListener("pointerdown", closeSettingsOutside);
  }, []);
  async function request(path: string, method: string, body?: unknown) {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await readJson<{ error?: string; copies?: LocalCopy[]; tables?: unknown; imagesMissing?: number; missing?: number }>(response);
    if (!response.ok) throw new Error(data.error ?? "Database operation failed.");
    return data;
  }
  async function copyProduction() {
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await request("/api/development-copy-production", "POST");
      setCopies(data.copies ?? []);
      window.dispatchEvent(new Event("local-databases-updated"));
      setMessage(`Copy saved. Rename it below, then select it in the sidebar.${data.imagesMissing ? ` ${data.imagesMissing} source images were unavailable.` : ""}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Copy failed."); }
    finally { setBusy(false); }
  }
  async function rename(id: string, name: string) {
    if (!name.trim()) return;
    setError("");
    try {
      await request("/api/development-copy-production", "PATCH", { id, name });
      window.dispatchEvent(new Event("local-databases-updated"));
      try { localStorage.setItem("fsd-copy-names-changed", String(Date.now())); } catch {}
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Rename failed."); }
  }
  function renameOnChange(id: string, name: string) {
    setCopies((current) => current.map((copy) => copy.id === id ? { ...copy, name } : copy));
    const previous = renameTimers.current.get(id);
    if (previous) clearTimeout(previous);
    renameTimers.current.set(id, setTimeout(() => { renameTimers.current.delete(id); void rename(id, name); }, 350));
  }
  async function copyToCatalog(copy: LocalCopy) {
    setCatalogCopyToConfirm(null);
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await request("/api/development-copy-production", "PUT", { source: copy.id });
      window.dispatchEvent(new Event("local-databases-updated"));
      try { localStorage.setItem("fsd-storage-changed", String(Date.now())); } catch {}
      setMessage(`Catalog replaced from ${copy.name}.${data.imagesMissing ? ` ${data.imagesMissing} source images were unavailable.` : ""}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not replace Catalog."); }
    finally { setBusy(false); }
  }
  function upload() {
    const name = selected === "catalog" ? "Catalog" : copies.find(copy => copy.id === selected)?.name;
    if (name) setProductionUploadToConfirm(name);
  }
  async function confirmUpload() {
    const name = productionUploadToConfirm;
    if (!name) return;
    setProductionUploadToConfirm(null);
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/administrators/export", { cache: "no-store" });
      const data = await readJson<{ tables?: unknown; error?: string }>(response);
      if (!response.ok || !data.tables) throw new Error(data.error ?? "Export failed.");
      const result = await request("/api/administrators/replace-production", "POST", { source: selected, tables: data.tables });
      setMessage(`Production updated from ${name}. You are still editing locally.${result.missing ? ` ${result.missing} images were unavailable.` : ""}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed."); }
    finally { setBusy(false); }
  }
  function deleteCopy(copy: LocalCopy) {
    setCopyDeletionToConfirm(copy);
  }
  async function confirmDeleteCopy(copy: LocalCopy) {
    setCopyDeletionToConfirm(null);
    setBusy(true); setError("");
    try {
      await request("/api/development-copy-production", "DELETE", { id: copy.id });
      try { localStorage.setItem("fsd-storage-changed", String(Date.now())); } catch {}
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete copy."); }
    finally { setBusy(false); }
  }
  if (!selected) return null;
  const selectedName = selected === "catalog" ? "Catalog" : copies.find(copy => copy.id === selected)?.name ?? "Local database";
  return <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 font-sans text-sm text-slate-700 shadow-sm sm:p-6">
    <h2 className="m-0 font-sans text-xl font-semibold tracking-tight text-slate-900">Local development databases</h2>
    <p className="mt-1.5 text-sm text-slate-500">Work on a local copy, then upload it to production when ready.</p>
    <div className="my-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" />
      <div className="min-w-0"><p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Currently editing locally</p><p className="mb-0 mt-1 break-words font-medium text-slate-900">{selectedName}</p></div>
    </div>
    {error && <p role="alert" className="my-3 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {message && <p role="status" className="my-3 rounded-lg bg-emerald-50 p-3 text-emerald-800">{message}</p>}
    <section aria-labelledby="saved-databases-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><h3 id="saved-databases-title" className="m-0 font-sans text-base font-semibold text-slate-900">Saved on this computer</h3><span className="rounded-md bg-slate-50 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500 ring-1 ring-slate-200">{copies.length} / 8 copies</span></div><p className="mb-0 mt-1 text-xs leading-relaxed text-slate-500">Copy production to work locally. Select a database in the sidebar.</p></div>
        <button type="button" className={button} disabled={busy || copies.length >= 8} onClick={() => void copyProduction()}>{busy ? "Working…" : "Copy production locally"}</button>
      </div>
      <div ref={savedDatabases} aria-label="Saved local databases" className="relative rounded-xl border border-slate-200 bg-white">
        <div className="hidden grid-cols-[minmax(0,1fr)_11rem_auto] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid"><span>Database</span><span>Created</span><span>Actions</span></div>
        <article className="relative grid gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center sm:gap-4"><div className="min-w-0"><p className="m-0 break-words font-semibold text-slate-900">Catalog</p><p className="mb-0 mt-1 text-xs text-slate-500">Historical import · Built in</p></div><div>{selected === "catalog" && <span className="rounded-full bg-lime-100 px-2 py-0.5 text-xs font-medium text-lime-800">Current database</span>}</div><details className="sm:justify-self-end"><summary className={settingsButton}>Settings</summary><div className="mt-3 rounded-lg bg-white p-3 sm:absolute sm:right-4 sm:z-10 sm:w-72 sm:border sm:border-slate-200 sm:shadow-lg"><p className="m-0 text-xs leading-relaxed text-slate-500">{selected === "catalog" ? "This is the database currently selected in the sidebar." : "Select Catalog in the sidebar to manage it here."}</p>{selected === "catalog" && <button type="button" className="mt-3 w-full rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void upload()}>Upload to production</button>}</div></details></article>
        {copies.map(copy => <article key={copy.id} className="relative grid gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_11rem_auto] sm:items-center sm:gap-4"><div className="min-w-0"><p className="m-0 break-words font-semibold text-slate-900">{copy.name}</p>{selected === copy.id && <span className="mt-1 inline-block rounded-full bg-lime-100 px-2 py-0.5 text-xs font-medium text-lime-800 sm:hidden">Current database</span>}</div><div className="text-xs text-slate-500">{new Date(copy.createdAt).toLocaleDateString()}</div><details className="sm:justify-self-end"><summary className={settingsButton}>Settings</summary><div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3 sm:absolute sm:right-4 sm:z-10 sm:w-80 sm:border sm:border-slate-200 sm:shadow-lg"><label htmlFor={`local-copy-${copy.id}`} className="block text-xs font-medium text-slate-600">Database name<input id={`local-copy-${copy.id}`} aria-describedby="local-copy-autosave" maxLength={80} disabled={busy} value={copy.name} onChange={event => renameOnChange(copy.id, event.target.value)} className="mt-1.5 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-lime-600 focus:ring-2 focus:ring-lime-100 disabled:opacity-50" /></label><div className="flex flex-wrap gap-2"><button type="button" className={secondaryButton} disabled={busy} onClick={() => setCatalogCopyToConfirm(copy)}>Copy to Catalog</button>{selected === copy.id && <button type="button" className="rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void upload()}>Upload to production</button>}<button type="button" className="rounded-lg px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void deleteCopy(copy)}>Delete</button></div>{selected !== copy.id && <p className="m-0 text-xs text-slate-500">Select this database in the sidebar to upload it to production.</p>}</div></details></article>)}
      </div>
      <p id="local-copy-autosave" className="mb-0 mt-3 text-xs text-slate-500">Copy names save automatically as you type.</p>
    </section>
    {catalogCopyToConfirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="replace-catalog-title" aria-describedby="replace-catalog-description" className="w-full max-w-md rounded-xl border border-amber-300 bg-white p-5 shadow-2xl">
        <h2 id="replace-catalog-title" className="m-0 text-lg">Replace local Catalog?</h2>
        <p id="replace-catalog-description" className="font-sans text-sm text-slate-600">Replace the local Catalog with <strong>{catalogCopyToConfirm.name}</strong>? The Catalog&apos;s current local records and images will be removed.</p>
        <div className="mt-5 flex justify-end gap-3"><button type="button" autoFocus className={button} onClick={() => setCatalogCopyToConfirm(null)}>Cancel</button><button type="button" className="rounded-md bg-amber-700 px-4 py-2.5 font-sans text-xs font-semibold text-white hover:bg-amber-800" onClick={() => void copyToCatalog(catalogCopyToConfirm)}>Replace Catalog</button></div>
      </section>
    </div>}
    <ConfirmationDialog open={productionUploadToConfirm !== null} title="Replace production database?" description={<>Replace all production application data and administrator settings with <strong>{productionUploadToConfirm}</strong>? This overwrites production changes made since this local copy was created.</>} confirmLabel="Replace production" destructive onCancel={() => setProductionUploadToConfirm(null)} onConfirm={() => void confirmUpload()} />
    <ConfirmationDialog open={copyDeletionToConfirm !== null} title="Delete local copy?" description={<>Delete <strong>{copyDeletionToConfirm?.name}</strong>? Its local records, images, and backups will be permanently removed.</>} confirmLabel="Delete copy" destructive onCancel={() => setCopyDeletionToConfirm(null)} onConfirm={() => { if (copyDeletionToConfirm) void confirmDeleteCopy(copyDeletionToConfirm); }} />
  </section>;
}
