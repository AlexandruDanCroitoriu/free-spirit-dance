"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import ConfirmationDialog from "./confirmation-dialog";
import { romanianParts, type Backup, type Control } from "../lib/production-backups/model";

type Status = Control & { available: boolean; reason?: string; backups: Backup[]; requests: number };
const defaultEndpoint = "/api/administrators/production-backups";
const button = "rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold disabled:opacity-50";
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function ProductionBackups() {
  const [development, setDevelopment] = useState<boolean | null>(null);
  useEffect(() => { void fetch("/api/development-storage").then(r => r.json() as Promise<{ available?: boolean }>).then(d => setDevelopment(Boolean(d.available))).catch(() => setDevelopment(false)); }, []);
  if (development === null) return null;
  if (!development) return <BackupCard />;
  return <BackupCard endpoint="/api/development-production-backups" connectionControl={<p className="mt-3 font-semibold text-sky-950">These controls use the same Cloudflare backups and schedule as the production website. Switching affects every administrator.</p>} />;
}
function BackupCard({ local = false, endpoint = defaultEndpoint, connected = true, connectionControl }: { local?: boolean; endpoint?: string; connected?: boolean; connectionControl?: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [schedule, setSchedule] = useState<{ enabled: boolean; weekday: number; time: string; once: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ action: "activate" | "return" | "delete"; backup?: Backup } | null>(null);
  const [renaming, setRenaming] = useState<Backup | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json() as Status & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load backups.");
    setStatus(data); setLoadError("");
  }, [endpoint]);
  useEffect(() => {
    if (!connected) { setStatus(null); setLoadError(""); return; }
    let stopped = false;
    const refresh = () => { void load().catch(e => { if (!stopped) setLoadError(e instanceof Error ? e.message : "Could not load backups."); }); };
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [load, connected]);
  async function command(input: Record<string, unknown>) {
    if (!connected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const payload = { ...input, generation: status?.generation };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Backup operation failed.");
      setNotice(input.action === "schedule" ? "Backup schedule saved." : input.action === "rename" ? "Backup renamed." : "Operation started. Progress will appear below.");
      await load();
      if (local && ["activate", "return"].includes(String(input.action))) {
        window.dispatchEvent(new Event("local-databases-updated"));
      }
      setSchedule(null); setRenaming(null);
      if (input.action === "backup") setName("");
    } catch (e) { setError(e instanceof Error ? e.message : "Backup operation failed."); }
    finally { setBusy(false); }
  }
  const disabled = busy || Boolean(status?.job);
  return <section className="mb-6 rounded-xl border border-sky-200 bg-sky-50 p-5 font-sans text-sm">
    <h2 className="m-0 font-serif text-lg">{local ? "Local test backups" : "Production backups"}</h2>
    <p className="mt-2 text-slate-600">{local ? "Back up the local Catalog and its local photos on this computer. Restore into an editable local test copy. Production is never read or changed by this card." : "Save the original production database and all photos in Cloudflare. Backups expire after six months. Using a backup switches the live app for everyone to its editable working copy."}</p>
    {connectionControl}
    {connected && loadError && <p role="alert" className="mt-3 text-red-800">{loadError}</p>}
    {error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sky-900">{notice}</p>}
    {!connected ? <p className="mt-3">Connect to load your production backups. Backup files and photos stay in Cloudflare, and scheduled backups run even when this computer is off.</p> : !status ? <p className="mt-3">Loading backups…</p> : !status.available ? <p className="mt-3 rounded-lg bg-white p-3">{status.reason}</p> : <>
      <div className="my-4 rounded-lg border border-sky-200 bg-white p-3"><strong>Currently in use: </strong>{status.active === "production" ? (local ? "Local Catalog" : "Original production") : status.backups.find(b => b.id === status.active)?.name ?? "Backup working copy"}
        {status.active !== "production" && <button className={`${button} ml-3`} disabled={disabled} onClick={() => setConfirmation({ action: "return" })}>{local ? "Return to local Catalog" : "Return to original production"}</button>}
      </div>
      {status.job && <p role="status" className="mb-3">{status.job.kind === "backup" ? "Creating backup" : status.job.kind === "activate" ? "Preparing and activating working copy" : status.job.kind === "delete" ? "Deleting backup" : "Returning to original production"}… {status.maintenance && "Application data is temporarily paused."}</p>}
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void command({ action: "backup", name }); }}>
        <input aria-label="New backup name (optional)" placeholder="Backup name (optional)" maxLength={80} className="min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2" value={name} onChange={e => setName(e.target.value)} />
        <button disabled={disabled} className="rounded-md bg-slate-800 px-4 py-2 font-semibold text-white disabled:opacity-50">Create backup</button>
      </form>
      <p className="mt-2 text-xs text-slate-600">{local ? "Local backups pause local data access while copying. Restored copies reserve one of the eight local copy slots." : "Creating a backup briefly pauses application data while the database and photos are copied."}</p>
      <div className="mt-5 border-t border-sky-200 pt-4">
        {local && <p className="mb-2 text-xs">Schedules run only while the development server is running. Missed runs are checked when it resumes.</p>}
        <p><strong>Automatic backups: </strong>{status.schedule.enabled ? `${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][status.schedule.weekday]} at ${status.schedule.time}` : "Paused"} · Romania time</p>
        {status.schedule.enabled && <p className="mt-1 text-xs">Next: {date(status.schedule.next)} · Europe/Bucharest, including daylight-saving changes.</p>}
        {status.schedule.once && <p className="mt-1 text-xs">Additional one-time backup: {date(status.schedule.once)}</p>}
        <button className={`${button} mt-2`} disabled={busy} onClick={() => setSchedule({ ...status.schedule, once: status.schedule.once ? romanianParts(new Date(status.schedule.once)) : "" })}>Edit schedule</button>
        {schedule && <form className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-white p-3" onSubmit={e => { e.preventDefault(); void command({ action: "schedule", ...schedule, once: schedule.once || null }); }}>
          <label><input type="checkbox" checked={schedule.enabled} onChange={e => setSchedule({ ...schedule, enabled: e.target.checked })} /> Weekly backup</label>
          <label className="grid gap-1">Day<select className={button} value={schedule.weekday} onChange={e => setSchedule({ ...schedule, weekday: Number(e.target.value) })}>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,i) => <option key={day} value={i}>{day}</option>)}</select></label>
          <label className="grid gap-1">Romania time<input className={button} required type="time" value={schedule.time} onChange={e => setSchedule({ ...schedule, time: e.target.value })} /></label>
          <label className="grid gap-1">One-time backup (optional)<input className={button} type="datetime-local" value={schedule.once} onChange={e => setSchedule({ ...schedule, once: e.target.value })} /></label>
          <button disabled={busy} className={button}>Save schedule</button><button type="button" className={button} onClick={() => setSchedule(null)}>Cancel</button>
        </form>}
      </div>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Saved production backups, dates shown in Romania time</caption><thead><tr><th className="py-2">Backup</th><th>Created / expires</th><th>Contents</th><th>Status</th><th>Actions</th></tr></thead><tbody>{status.backups.map(backup => <tr key={backup.id} className="border-t border-sky-200">
        <td className="py-3 pr-3"><strong>{backup.name}</strong>{backup.workingReady && <div className="mt-1">Editable copy saved</div>}{backup.error && <p role="alert" className="mt-1 max-w-64 text-red-800">{backup.error}</p>}</td>
        <td className="pr-3">{date(backup.createdAt)}<br /><span className="text-slate-500">{date(backup.expiresAt)}</span></td>
        <td className="pr-3">{(backup.bytes / 1024 / 1024).toFixed(2)} MB<br />{backup.photos} photos</td>
        <td className="pr-3">{status.active === backup.id ? "Active · retained" : backup.status}</td>
        <td className="py-2"><div className="flex flex-wrap gap-2"><button className={button} disabled={disabled || backup.status !== "ready" || status.active === backup.id || Date.parse(backup.expiresAt) <= Date.now()} onClick={() => setConfirmation({ action: "activate", backup })}>{backup.workingReady ? "Use working copy" : "Use this backup"}</button><button className={button} disabled={disabled} onClick={() => setRenaming(backup)}>Rename</button><button className={`${button} text-red-800`} disabled={disabled || status.active === backup.id} onClick={() => setConfirmation({ action: "delete", backup })}>Delete</button></div></td>
      </tr>)}</tbody></table>{!status.backups.length && <p className="py-4 text-slate-600">No backups yet.</p>}</div>
      <p className="mt-3 text-xs text-slate-600">{local ? "The local Catalog is always the source. Use “Backup test workspace” in the sidebar to browse the selected local test database. Backups expire after six months; active copies are retained. Return to local Catalog preserves edits in the test copy." : "Edits stay in each working copy and are not merged when switching. Original production is always the backup source. Expired active copies are retained until you switch away."}</p>
      {renaming && <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); void command({ action: "rename", id: renaming.id, name: renaming.name }); }}><input aria-label="Backup name" className={button} required maxLength={80} value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} /><button disabled={busy} className={button}>Save name</button><button type="button" className={button} onClick={() => setRenaming(null)}>Cancel</button></form>}
    </>}
    <ConfirmationDialog open={Boolean(confirmation)} title={local ? "Confirm local backup operation" : confirmation?.action === "delete" ? "Delete backup and working copy?" : confirmation?.action === "return" ? "Return everyone to original production?" : "Switch everyone to this backup?"} description={local ? (confirmation?.action === "delete" ? "Permanently delete this local snapshot and its saved working-copy edits? Production is unaffected." : "Switch the backup test workspace on this computer? Reload local pages before editing. Production is unaffected.") : confirmation?.action === "delete" ? "The saved snapshot, photos, and any edits in its working copy will be permanently deleted." : confirmation?.action === "return" ? "Everyone will use original production again. Edits in the current working copy are preserved separately and will not be merged." : `The live app will use ${confirmation?.backup?.name ?? "this backup"}. ${confirmation?.backup?.workingReady ? "Its previously saved edits will be retained." : "An editable copy will be created first."} Open pages must be reloaded before saving.`} confirmLabel={confirmation?.action === "delete" ? "Delete permanently" : "Switch database"} destructive={confirmation?.action === "delete"} onCancel={() => setConfirmation(null)} onConfirm={() => { const value = confirmation; setConfirmation(null); if (value) void command({ action: value.action, ...(value.backup ? { id: value.backup.id } : {}) }); }} />
  </section>;
}
