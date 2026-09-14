"use client";
import { useEffect, useRef, useState } from "react";
import { type LocalCopy } from "../lib/local-copies";
import { readJson } from "../lib/http";
import ConfirmationDialog from "./confirmation-dialog";

const button = "rounded-md bg-slate-800 px-4 py-2.5 font-sans text-xs font-semibold text-white disabled:opacity-50";
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
  useEffect(() => { void fetch("/api/development-storage", { cache: "no-store" }).then(readJson<{ available: boolean; selected: string; copies: LocalCopy[] }>).then(data => { if (data.available) { setSelected(data.selected); setCopies(data.copies); } }).catch(() => {}); }, []);
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
  return <div className="mb-6">
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="min-w-0 rounded-xl border border-lime-200 bg-lime-50 p-5">
        <h2 className="m-0 text-lg">Local development databases</h2>
        <p className="font-sans text-sm">Save a fresh production copy on this computer. Copy names save automatically as you type. {copies.length}/8 copies.</p>
        <button type="button" className={button} disabled={busy || copies.length >= 8} onClick={() => void copyProduction()}>{busy ? "Working…" : "Copy production locally"}</button>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left font-sans text-xs"><caption className="sr-only">Saved local databases</caption><thead><tr><th className="py-2">Database name</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody><tr><td className="py-3">Catalog</td><td>Historical import</td><td>Built in</td></tr>{copies.map(copy => <tr key={copy.id} className="border-t border-lime-200"><td className="py-2 pr-2"><input aria-label={`Database name for ${copy.id}`} maxLength={80} disabled={busy} value={copy.name} onChange={event => renameOnChange(copy.id, event.target.value)} className="w-full min-w-24 rounded border border-stone-300 bg-white p-2" /></td><td className="pr-2">{new Date(copy.createdAt).toLocaleDateString()}</td><td><button type="button" className="mt-1 rounded border border-amber-500 px-3 py-2 text-amber-900 disabled:opacity-50" disabled={busy} onClick={() => setCatalogCopyToConfirm(copy)}>Copy to Catalog</button><button type="button" className="mt-1 rounded border border-red-300 px-3 py-2 text-red-800 disabled:opacity-50" disabled={busy} onClick={() => void deleteCopy(copy)}>Delete</button></td></tr>)}</tbody></table></div>
      </section>
      <section className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h2 className="m-0 text-lg">Upload current database to production</h2>
        <p className="font-sans text-sm">Current database: <strong>{selected === "catalog" ? "Catalog" : copies.find(copy => copy.id === selected)?.name}</strong></p>
        <p className="font-sans text-sm">Replace production application records, administrator settings, and referenced images with the selected local database. This overwrites changes made in production since your copy was created.</p>
        <button type="button" className={button + " bg-red-800"} disabled={busy} onClick={() => void upload()}>Upload current database to production</button>
      </section>
    </div>
    {error && <p role="alert" className="font-sans text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="font-sans text-sm text-lime-800">{message}</p>}
    {catalogCopyToConfirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="replace-catalog-title" aria-describedby="replace-catalog-description" className="w-full max-w-md rounded-xl border border-amber-300 bg-white p-5 shadow-2xl">
        <h2 id="replace-catalog-title" className="m-0 text-lg">Replace local Catalog?</h2>
        <p id="replace-catalog-description" className="font-sans text-sm text-slate-600">Replace the local Catalog with <strong>{catalogCopyToConfirm.name}</strong>? The Catalog&apos;s current local records and images will be removed.</p>
        <div className="mt-5 flex justify-end gap-3"><button type="button" autoFocus className={button} onClick={() => setCatalogCopyToConfirm(null)}>Cancel</button><button type="button" className="rounded-md bg-amber-700 px-4 py-2.5 font-sans text-xs font-semibold text-white hover:bg-amber-800" onClick={() => void copyToCatalog(catalogCopyToConfirm)}>Replace Catalog</button></div>
      </section>
    </div>}
    <ConfirmationDialog open={productionUploadToConfirm !== null} title="Replace production database?" description={<>Replace all production application data and administrator settings with <strong>{productionUploadToConfirm}</strong>? This overwrites production changes made since this local copy was created.</>} confirmLabel="Replace production" destructive onCancel={() => setProductionUploadToConfirm(null)} onConfirm={() => void confirmUpload()} />
    <ConfirmationDialog open={copyDeletionToConfirm !== null} title="Delete local copy?" description={<>Delete <strong>{copyDeletionToConfirm?.name}</strong>? Its local records, images, and backups will be permanently removed.</>} confirmLabel="Delete copy" destructive onCancel={() => setCopyDeletionToConfirm(null)} onConfirm={() => { if (copyDeletionToConfirm) void confirmDeleteCopy(copyDeletionToConfirm); }} />
  </div>;
}
