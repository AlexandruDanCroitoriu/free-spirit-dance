"use client";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import ConfirmationDialog from "./confirmation-dialog";
import { romanianParts, type Backup, type Control } from "../lib/production-backups/model";

type Status = Control & { available: boolean; reason?: string; backups: Backup[]; requests: number };
const defaultEndpoint = "/api/administrators/production-backups";
const button = "rounded-md border border-stone-300 bg-white px-3 py-2 font-sans text-xs font-semibold disabled:opacity-50";
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function BackupActions({ name, children }: { name: string; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const position = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect(), menu = popup.current;
    if (!anchor || !menu) return;
    menu.style.maxHeight = `${window.innerHeight - 16}px`;
    menu.style.left = `${Math.max(8, Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    const below = anchor.bottom + 6;
    menu.style.top = `${Math.max(8, below + menu.offsetHeight <= window.innerHeight - 8 ? below : anchor.top - menu.offsetHeight - 6)}px`;
  }, []);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const observer = new ResizeObserver(position);
    if (popup.current) observer.observe(popup.current);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); observer.disconnect(); };
  }, [open, position]);
  return <>
    <button ref={trigger} type="button" popoverTarget={id} aria-label={`Backup actions for ${name}`} title="Backup actions" aria-expanded={open} aria-controls={id} aria-haspopup="dialog" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 bg-white text-slate-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m9 3-.6 2.4-1.8 1.1-2.4-.7-3 5.2L3 12.8v2.1l-1.8 1.8 3 5.2 2.4-.7 1.8 1.1L9 24h6l.6-2.4 1.8-1.1 2.4.7 3-5.2-1.8-1.8v-2.1l1.8-1.8-3-5.2-2.4.7-1.8-1.1L15 3Z" transform="translate(2 0) scale(.83)"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    <div ref={popup} id={id} popover="auto" role="dialog" aria-label={`Actions for ${name}`} onToggle={event => { const shown = event.newState === 'open'; setOpen(shown); if (shown) position(); }} onClick={event => { const target = event.target instanceof Element ? event.target.closest('button') : null; if (target && !target.disabled) popup.current?.hidePopover(); }} className="fixed m-0 w-56 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-stone-200 bg-white p-1.5 shadow-xl [&>button]:mb-0.5 [&>button]:block [&>button]:w-full [&>button]:rounded-md [&>button]:border-0 [&>button]:px-3 [&>button]:py-2.5 [&>button]:text-left [&>button:hover]:bg-stone-100">
      {children}
    </div>
  </>;
}

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
  const [confirmation, setConfirmation] = useState<{ action: "activate" | "return" | "delete"; readOnly?: boolean; backup?: Backup } | null>(null);
  const [renaming, setRenaming] = useState<Backup | null>(null);
  const [recovering, setRecovering] = useState(false);
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
      setNotice(input.action === "recover-requests" ? "Stuck request tracking cleared. You can create a new backup. Reload other pages before saving." : input.action === "schedule" ? "Backup schedule saved." : input.action === "rename" ? "Backup renamed." : "Operation started. Progress will appear below.");
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
    <p className="mt-2 text-slate-600">{local ? "Back up the local Catalog and its local photos on this computer." : "Manage production snapshots and editable manual backups. Preview backups read-only, or replace production after saving an automatic safety backup."}</p>
    {connectionControl}
    {connected && loadError && <p role="alert" className="mt-3 text-red-800">{loadError}</p>}
    {error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sky-900">{notice}</p>}
    {!connected ? <p className="mt-3">Connect to load your production backups. Backup files and photos stay in Cloudflare, and scheduled backups run even when this computer is off.</p> : !status ? <p className="mt-3">Loading backups…</p> : !status.available ? <p className="mt-3 rounded-lg bg-white p-3">{status.reason}</p> : <>
      <div className="my-4 rounded-lg border border-sky-200 bg-white p-3"><strong>Currently in use: </strong>{status.active === "production" ? (local ? "Local Catalog" : "Original production") : status.backups.find(b => b.id === status.active)?.name ?? "Backup working copy"}{status.readOnly && <span className="ml-2 font-semibold text-amber-800">Read-only preview · saves are blocked</span>}
        {(status.readOnly || (local && status.active !== "production")) && <button className={`${button} ml-3`} disabled={disabled} onClick={() => setConfirmation({ action: "return" })}>{status.readOnly ? "Exit read-only preview" : "Return to local Catalog"}</button>}
      </div>
      {status.job && <p role="status" className="mb-3">{status.job.kind === "backup" ? "Creating backup" : status.job.kind === "activate" ? "Preparing and activating working copy" : status.job.kind === "delete" ? "Deleting backup" : "Returning to original production"}… {status.maintenance && "Application data is temporarily paused."}</p>}
      {!local && !status.job && status.requests > 0 && status.backups.some(backup => backup.status === "failed") && <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3"><p>{status.requests} request(s) are still marked as running. If all administrators have stopped using the app and no save, upload or import is running, close other tabs and wait 10 minutes before recovery.</p><button type="button" className={button} disabled={disabled} onClick={() => setRecovering(true)}>Recover stuck requests</button></div>}
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
      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        {(["manual", "automatic"] as const).map(category => <section key={category} className="min-w-0 rounded-xl border border-stone-200 bg-white p-4">
          <div className="mb-4"><h3 className="m-0 font-serif text-lg">{category === "manual" ? "Manual backups" : "Automatic backups"}</h3><p className="mt-1 text-xs text-slate-500">{category === "manual" ? "Editable working copies you can use as production." : "Read-only snapshots from scheduled runs and production switches."}</p></div>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="pb-3">Backup</th><th className="pb-3">Status</th><th className="pb-3">Actions</th></tr></thead><tbody>
            {status.backups.filter(backup => (backup.category ?? "manual") === category).map(backup => <tr key={backup.id} className="border-t border-stone-100">
              <td className="py-4 pr-3"><strong className="block">{backup.name}</strong><span className="mt-1 block text-slate-500">{date(backup.createdAt)} · {(backup.bytes / 1024 / 1024).toFixed(2)} MB · {backup.photos} photos</span><span className="block text-slate-500">Expires {date(backup.expiresAt)}</span>{backup.error && <p role="alert" className="mt-2 max-w-64 text-red-800">{backup.error}</p>}</td>
              <td className="pr-3"><span className={backup.status === "failed" ? "text-red-700" : status.active === backup.id ? "font-semibold text-green-700" : "text-slate-600"}>{status.active === backup.id ? (status.readOnly ? "Read-only preview" : "In production") : backup.status}</span></td>
              <td><BackupActions name={backup.name}>{category === "automatic" ? <><button className={button} disabled={disabled || backup.status !== "ready" || Date.parse(backup.expiresAt) <= Date.now()} onClick={() => void command({ action: "backup", sourceBackupId: backup.id, name: `Copy of ${backup.name}`.slice(0,80) })}>Create manual copy</button><button className={button} disabled={disabled || backup.status !== "ready" || Date.parse(backup.expiresAt) <= Date.now()} onClick={() => setConfirmation({ action: "activate", backup })}>Replace production</button></> : <><button className={button} disabled={disabled || backup.status !== "ready" || (status.active === backup.id && status.readOnly) || Date.parse(backup.expiresAt) <= Date.now()} onClick={() => setConfirmation({ action: "activate", backup, readOnly: true })}>View read-only</button><button className={button} disabled={disabled || backup.status !== "ready" || (status.active === backup.id && !status.readOnly) || Date.parse(backup.expiresAt) <= Date.now()} onClick={() => setConfirmation({ action: "activate", backup })}>Replace production</button><button className={button} disabled={disabled} onClick={() => setRenaming(backup)}>Rename</button></>}<button className={button + " text-red-700"} disabled={disabled || status.active === backup.id} onClick={() => setConfirmation({ action: "delete", backup })}>Delete</button></BackupActions></td>
            </tr>)}
          </tbody></table></div>
          {!status.backups.some(backup => (backup.category ?? "manual") === category) && <p className="py-6 text-center text-slate-500">No {category} backups yet.</p>}
        </section>)}
      </div>
      <p className="mt-3 text-xs text-slate-600">Before replacing production, the currently active data and photos are saved in Automatic backups. Read-only previews block saves and do not create automatic backups.</p>
      {renaming && <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); void command({ action: "rename", id: renaming.id, name: renaming.name }); }}><input aria-label="Backup name" className={button} required maxLength={80} value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} /><button disabled={busy} className={button}>Save name</button><button type="button" className={button} onClick={() => setRenaming(null)}>Cancel</button></form>}
    </>}
    <ConfirmationDialog open={recovering} title="Recover stuck request tracking?" description="Confirm that every administrator has stopped using the app, all other tabs are closed, and no save, upload or import is running. Recovery clears tracking records; it cannot cancel a running write. Wait at least 10 minutes after stopping activity. Existing backups and student records are preserved." confirmLabel="Confirm idle and recover" destructive onCancel={() => setRecovering(false)} onConfirm={() => { setRecovering(false); void command({ action: "recover-requests", confirmedIdle: true }); }} />
    <ConfirmationDialog open={Boolean(confirmation)} title={confirmation?.readOnly ? "View this backup read-only?" : local ? "Confirm local backup operation" : confirmation?.action === "delete" ? "Delete backup and working copy?" : confirmation?.action === "return" ? (status?.readOnly ? "Exit read-only preview?" : "Return everyone to original production?") : "Switch everyone to this backup?"} description={confirmation?.readOnly ? "Everyone will view this backup in read-only mode. Saves are blocked. Production remains unchanged and no automatic safety backup is created. Return to production to resume normal use." : confirmation?.action === "return" && status?.readOnly ? "End the read-only preview and resume the production database you were using before it. No automatic safety backup is needed." : local ? (confirmation?.action === "delete" ? "Permanently delete this local snapshot and its saved working-copy edits? Production is unaffected." : "Switch the backup test workspace on this computer? Reload local pages before editing. Production is unaffected.") : confirmation?.action === "delete" ? "The saved snapshot, photos, and any edits in its working copy will be permanently deleted." : confirmation?.action === "return" ? "An automatic safety backup will be saved first. Everyone will use original production again. Edits in the current working copy are preserved separately and will not be merged." : `An automatic safety backup will be saved first. The live app will then use ${confirmation?.backup?.name ?? "this backup"}. ${confirmation?.backup?.workingReady ? "Its previously saved edits will be retained." : "An editable copy will be created first."} Open pages must be reloaded before saving.`} confirmLabel={confirmation?.readOnly ? "View read-only" : confirmation?.action === "delete" ? "Delete permanently" : confirmation?.action === "return" && status?.readOnly ? "Exit preview" : "Switch database"} destructive={confirmation?.action === "delete"} onCancel={() => setConfirmation(null)} onConfirm={() => { const value = confirmation; setConfirmation(null); if (value) void command({ action: value.action, readOnly: value.readOnly ?? false, ...(value.backup ? { id: value.backup.id } : {}) }); }} />
  </section>;
}
