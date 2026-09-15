"use client";
import { useEffect, useRef, useState } from "react";
import { type LocalCopy } from "../lib/local-copies";
import { readJson } from "../lib/http";
import ConfirmationDialog from "./confirmation-dialog";

const button = "rounded-lg bg-slate-900 px-4 py-2.5 font-sans text-sm font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 disabled:cursor-not-allowed disabled:opacity-50";
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
  useEffect(() => {
    let stopped = false;
    const refresh = () => { void fetch("/api/development-storage", { cache: "no-store" }).then(readJson<{ available: boolean; selected: string; copies: LocalCopy[] }>).then(data => { if (!stopped && data.available) { setSelected(data.selected); setCopies(data.copies); } }).catch(() => {}); };
    refresh();
    window.addEventListener('local-databases-updated', refresh);
    return () => { stopped = true; window.removeEventListener('local-databases-updated', refresh); };
  }, []);
  useEffect(() => () => { renameTimers.current.forEach(clearTimeout); }, []);
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
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
        <div className="border-b border-slate-100 bg-slate-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 font-sans text-sm font-semibold text-slate-900">Saved on this computer</h3><span className="rounded-md bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500 ring-1 ring-slate-200">{copies.length} / 8 copies</span></div>
          <p className="mb-3 mt-1 text-xs leading-relaxed text-slate-500">Copy production to work locally. Select a database in the sidebar.</p>
          <button type="button" className={button} disabled={busy || copies.length >= 8} onClick={() => void copyProduction()}>{busy ? "Working…" : "Copy production locally"}</button>
        </div>
        <ul aria-label="Saved local databases" className="m-0 list-none divide-y divide-slate-100 p-0">
          <li className="flex flex-wrap items-center justify-between gap-2 p-4"><div><p className="m-0 font-medium text-slate-900">Catalog</p><p className="mb-0 mt-1 text-xs text-slate-500">Historical import · Built in</p></div>{selected === 'catalog' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Current database</span>}</li>
          {copies.map(copy => <li key={copy.id} className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><label htmlFor={`local-copy-${copy.id}`} className="text-xs font-medium text-slate-500">Database name</label>{selected === copy.id && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Current database</span>}</div>
            <input id={`local-copy-${copy.id}`} aria-describedby="local-copy-autosave" maxLength={80} disabled={busy} value={copy.name} onChange={event => renameOnChange(copy.id, event.target.value)} className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-lime-600 focus:ring-2 focus:ring-lime-100 disabled:opacity-50" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-slate-500">Created {new Date(copy.createdAt).toLocaleDateString()}</span><div className="flex flex-wrap gap-2"><button type="button" className={secondaryButton} disabled={busy} onClick={() => setCatalogCopyToConfirm(copy)}>Copy to Catalog</button><button type="button" className="rounded-lg px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void deleteCopy(copy)}>Delete</button></div></div>
          </li>)}
        </ul>
        <p id="local-copy-autosave" className="m-0 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Copy names save automatically as you type.</p>
      </section>
      <section className="min-w-0 rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 font-sans text-sm font-semibold text-slate-900">Upload to production</h3><span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Affects everyone</span></div>
        <p className="mb-0 mt-3 text-xs text-slate-500">Upload source</p><p className="mb-4 mt-1 break-words font-medium text-slate-900">{selectedName}</p>
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950"><strong className="mb-1 block font-semibold">This replaces live production data.</strong>Application records, administrator settings, and referenced images will be replaced by this local database. Any newer production changes will be overwritten.</div>
        <button type="button" className="w-full rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void upload()}>Upload current database to production</button>
        <p className="mb-0 mt-2 text-xs text-slate-500">You’ll be asked to confirm before anything is replaced.</p>
      </section>
    </div>
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
