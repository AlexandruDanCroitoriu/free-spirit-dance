"use client";
import DatePicker from './date-picker';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import ConfirmationDialog from "./confirmation-dialog";
import { backupTable, romanianParts, type Backup, type Control } from "../lib/production-backups/model";

type Status = Control & { available: boolean; reason?: string; backups: Backup[]; requests: number };
const defaultEndpoint = "/api/administrators/production-backups";
const button = "rounded-lg border border-slate-200 bg-white px-3 py-2 font-sans text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 disabled:cursor-not-allowed disabled:opacity-50";
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
  return <BackupCard endpoint="/api/development-production-backups" connectionControl={<p className="mt-3 inline-flex rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Connected to live production · Changes here affect all administrators.</p>} />;
}
function BackupCard({ local = false, endpoint = defaultEndpoint, connected = true, connectionControl }: { local?: boolean; endpoint?: string; connected?: boolean; connectionControl?: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [schedule, setSchedule] = useState<{ enabled: boolean; weekday: number; time: string; once: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ action: "activate" | "return" | "delete" | "normalize"; readOnly?: boolean; backup?: Backup } | null>(null);
  const [renaming, setRenaming] = useState<Backup | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveringDeletion, setRecoveringDeletion] = useState<string | null>(null);
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
    setBusy(true); setError(""); setNotice(input.action === 'save-local' ? 'Saving the backup and photos locally… Keep this page open until it finishes.' : '');
    try {
      const payload = { ...input, generation: status?.generation };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Backup operation failed.");
      setNotice(input.action === "recover-requests" ? "Stuck request tracking cleared. You can create a new backup. Reload other pages before saving." : input.action === "schedule" ? "Backup schedule saved." : input.action === "rename" ? "Backup renamed." : "Operation started. Progress will appear below.");
      if (input.action === "recover-deletion") setNotice("Deletion recovery completed. If the backup is still listed, choose Delete again to finish cleanup.");
      if (input.action === 'save-local') {
        setNotice('Backup saved in Local development databases. Select it in the sidebar to work locally. Production is unchanged.');
        window.dispatchEvent(new Event('local-databases-updated'));
      }
      await load();
      if (local && ["activate", "return"].includes(String(input.action))) {
        window.dispatchEvent(new Event("local-databases-updated"));
      }
      setSchedule(null); setRenaming(null);
      if (input.action === "backup") setName("");
    } catch (e) { setNotice(''); setError(e instanceof Error ? e.message : "Backup operation failed."); }
    finally { setBusy(false); }
  }
  const disabled = busy || Boolean(status?.job);
  const activeError = status?.backups.find(backup => backup.id === status.active)?.error;
  return <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 font-sans text-sm text-slate-700 shadow-sm sm:p-6">
    <h2 className="m-0 font-sans text-xl font-semibold tracking-tight text-slate-900">{local ? "Local test backups" : "Production backups"}</h2>
    <p className="mt-1.5 text-sm text-slate-500">{local ? "Save and restore the Catalog on this computer." : "Save your data, preview a copy, or restore production."}</p>
    {connectionControl}
    {connected && loadError && <p role="alert" className="mt-3 text-red-800">{loadError}</p>}
    {error && <p role="alert" className="mt-3 text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sky-900">{notice}</p>}
    {!connected ? <p className="mt-3">Connect to load your production backups. Backup files and photos stay in Cloudflare, and scheduled backups run even when this computer is off.</p> : !status ? <p className="mt-3">Loading backups…</p> : !status.available ? <p className="mt-3 rounded-lg bg-white p-3">{status.reason}</p> : <>
      <div className={`my-5 flex flex-wrap items-center gap-3 rounded-xl border p-4 ${status.readOnly ? 'border-amber-200 bg-amber-50' : 'border-emerald-100 bg-emerald-50/60'}`}>
        <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.readOnly ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        <div className="min-w-0 flex-1"><p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{status.readOnly ? 'Read-only preview' : 'Live production'}</p><p className="mb-0 mt-1 break-words font-medium text-slate-900">{status.active === "production" ? (local ? "Local Catalog" : "FS-Dance-Db") : status.backups.find(b => b.id === status.active)?.name ?? "Production database"}</p>{status.readOnly && <p className="mb-0 mt-1 text-xs text-amber-800">Viewing a copy. Saving is disabled; production is unchanged.</p>}</div>
        {(status.readOnly || (local && status.active !== "production")) && <button className={`${button} ml-3`} disabled={disabled} onClick={() => setConfirmation({ action: "return" })}>{status.readOnly ? "Exit read-only preview" : "Return to local Catalog"}</button>}
      </div>
      {!local && !status.readOnly && status.active !== 'production' && <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3"><p>Live data is still stored in a previously activated backup. Move its current data and photos into FS-Dance-Db to keep production in one database. A safety backup is saved first.</p><button type="button" className={button} disabled={disabled} onClick={() => setConfirmation({ action: 'normalize' })}>Move live data to FS-Dance-Db</button></div>}
      {!status.job && activeError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">The last operation on the live database failed: {activeError} The live database has not switched.</p>}
      {status.job?.error && <div role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3"><p>{status.job.error}</p><button type="button" className={button} disabled={busy} onClick={() => void command({ action: 'retry-restore', jobId: status.job!.id })}>Retry restore</button></div>}
      {status.job && <p role="status" className="mb-3">{status.job.kind === "backup" ? "Creating backup" : status.job.kind === "normalize" ? "Moving live data to FS-Dance-Db" : status.job.kind === "activate" ? (status.job.readOnly ? "Preparing preview" : "Restoring FS-Dance-Db") : status.job.kind === "delete" ? "Deleting backup" : "Returning to original production"}… {status.maintenance && "Application data is temporarily paused."}</p>}
      {!local && status.job?.kind === "delete" && Date.now() - Date.parse(status.job.startedAt) >= 5 * 60_000 && <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3"><p>Deletion is taking longer than expected. You can stop this deletion job and unlock the backup controls, then retry Delete to remove any remaining files. Production is unaffected.</p><button type="button" className={button} disabled={busy} onClick={() => setRecoveringDeletion(status.job!.id)}>Recover stalled deletion</button></div>}
      {!local && !status.job && status.requests > 0 && status.backups.some(backup => backup.status === "failed" || Boolean(backup.error)) && <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3"><p>{status.requests} request(s) are still marked as running. If all administrators have stopped using the app and no save, upload or import is running, close other tabs and wait 10 minutes before recovery.</p><button type="button" className={button} disabled={disabled} onClick={() => setRecovering(true)}>Recover stuck requests</button></div>}
      <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="mb-3 mt-0 font-sans text-sm font-semibold text-slate-900">Create a manual backup</h3>
      <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void command({ action: "backup", name }); }}>
        <input aria-label="New backup name (optional)" placeholder="Name your backup (optional)" maxLength={80} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none focus:border-lime-600 focus:ring-2 focus:ring-lime-100" value={name} onChange={e => setName(e.target.value)} />
        <button disabled={disabled} className="rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">Create backup</button>
      </form>
      <p className="mt-2 text-xs text-slate-600">{local ? "Local backups pause local data access while copying. Restored copies reserve one of the eight local copy slots." : "Creating a backup briefly pauses application data while the database and photos are copied."}</p>
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        {local && <p className="mb-2 text-xs">Schedules run only while the development server is running. Missed runs are checked when it resumes.</p>}
        <p className="m-0 text-sm font-semibold text-slate-900">Backup schedule <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${status.schedule.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{status.schedule.enabled ? 'Enabled' : 'Paused'}</span></p>
        <p className="mb-0 mt-2">{status.schedule.enabled ? `Every ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][status.schedule.weekday]} at ${status.schedule.time}` : "Weekly backups are paused"} <span className="text-xs text-slate-500">· Romania time</span></p>
        {status.schedule.enabled && <p className="mb-0 mt-1 text-xs text-slate-500">Next backup: {date(status.schedule.next)}</p>}
        {status.schedule.once && <p className="mt-1 text-xs">Additional one-time backup: {date(status.schedule.once)}</p>}
        <button className={`${button} mt-2`} disabled={busy} onClick={() => setSchedule({ ...status.schedule, once: status.schedule.once ? romanianParts(new Date(status.schedule.once)) : "" })}>Edit schedule</button>
        {schedule && <form className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-white p-3" onSubmit={e => { e.preventDefault(); void command({ action: "schedule", ...schedule, once: schedule.once || null }); }}>
          <label><input type="checkbox" checked={schedule.enabled} onChange={e => setSchedule({ ...schedule, enabled: e.target.checked })} /> Weekly backup</label>
          <label className="grid gap-1">Day<select className={button} value={schedule.weekday} onChange={e => setSchedule({ ...schedule, weekday: Number(e.target.value) })}>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((day,i) => <option key={day} value={i}>{day}</option>)}</select></label>
          <label className="grid gap-1">Romania time<input className={button} required type="time" value={schedule.time} onChange={e => setSchedule({ ...schedule, time: e.target.value })} /></label>
          <label className="grid gap-1">One-time backup (optional)<DatePicker className={button} type="datetime-local" value={schedule.once} onChange={e => setSchedule({ ...schedule, once: e.target.value })} /></label>
          <button disabled={busy} className={button}>Save schedule</button><button type="button" className={button} onClick={() => setSchedule(null)}>Cancel</button>
        </form>}
      </div>
      </div>
      <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-start gap-4">
        {(["manual", "automatic", "production-change"] as const).map(category => <section key={category} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50/70 p-4"><div className="flex items-center justify-between gap-2"><h3 className="m-0 font-sans text-sm font-semibold text-slate-900">{category === "manual" ? "Manual backups" : category === "automatic" ? "Automatic backups" : "Production change backups"}</h3><span className="rounded-md bg-white px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500 ring-1 ring-slate-200">{status.backups.filter(backup => !backup.snapshotDeleted && backupTable(backup) === category).length}</span></div><p className="mb-0 mt-1 text-xs leading-relaxed text-slate-500">{category === "manual" ? "Copies you create and manage." : category === "automatic" ? "Saved automatically on your schedule." : "Saved before each production replacement."}</p></div>
          <div className="px-4"><table aria-label={category === 'manual' ? 'Manual backups' : category === 'automatic' ? 'Automatic backups' : 'Production change backups'} className="w-full table-fixed text-left text-sm"><colgroup><col /><col className="w-10" /></colgroup><thead className="sr-only"><tr><th>Backup details and status</th><th className="w-10">Actions</th></tr></thead><tbody>
            {status.backups.filter(backup => !backup.snapshotDeleted && backupTable(backup) === category).map(backup => <tr key={backup.id} className="border-t border-stone-100">
              <td className="py-4 pr-3 align-top"><span className={`mb-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${backup.status === "failed" ? "bg-red-50 text-red-700" : status.active === backup.id ? (status.readOnly ? 'bg-amber-50 text-amber-800' : "bg-emerald-50 text-emerald-700") : "bg-slate-100 text-slate-600"}`}>{status.active === backup.id ? (status.readOnly ? "Preview" : "Live production") : backup.status === 'ready' ? 'Ready' : backup.status === 'failed' ? 'Failed' : backup.status === 'deleting' ? 'Deleting…' : 'Creating…'}</span><strong className="block break-words font-medium leading-relaxed text-slate-900">{backup.name}</strong><span className="mt-1.5 block text-xs text-slate-500">{date(backup.createdAt)}</span><span className="mt-1 block text-xs text-slate-500">{(backup.bytes / 1024 / 1024).toFixed(2)} MB · {backup.photos} photos</span><span className="mt-1 block text-xs text-slate-500">Expires {date(backup.expiresAt)}</span>{backup.error && <p role="alert" className="mt-2 break-words text-xs text-red-700">{backup.error}</p>}</td>
              <td className="w-10 py-4 align-top"><BackupActions name={backup.name}><button className={button} disabled={disabled || endpoint !== "/api/development-production-backups" || backup.status !== "ready" || Date.parse(backup.expiresAt) <= Date.now()} title={endpoint !== "/api/development-production-backups" ? "Open the local development app to save a local database" : "Copy this saved snapshot and its photos to Local development databases"} onClick={() => void command({ action: "save-local", id: backup.id })}>Save locally</button>{category !== "manual" ? <><button className={button} disabled={disabled || backup.status !== "ready" || Date.parse(backup.expiresAt) <= Date.now()} onClick={() => void command({ action: "backup", sourceBackupId: backup.id, name: `Copy of ${backup.name}`.slice(0,80) })}>Create manual copy</button><button className={button} disabled={disabled || status.active === backup.id || status.previewPrevious === backup.id || backup.status !== "ready" || Date.parse(backup.expiresAt) <= Date.now()} onClick={() => setConfirmation({ action: "activate", backup })}>Replace production</button></> : <><button className={button} disabled={disabled || backup.status !== "ready" || (status.active === backup.id && status.readOnly) || Date.parse(backup.expiresAt) <= Date.now()} onClick={() => setConfirmation({ action: "activate", backup, readOnly: true })}>View read-only</button><button className={button} disabled={disabled || backup.status !== "ready" || (status.active === backup.id && !status.readOnly) || Date.parse(backup.expiresAt) <= Date.now()} onClick={() => setConfirmation({ action: "activate", backup })}>Replace production</button><button className={button} disabled={disabled} onClick={() => setRenaming(backup)}>Rename</button></>}<button className={button + " text-red-700"} disabled={disabled || (status.readOnly && status.active === backup.id)} onClick={() => setConfirmation({ action: "delete", backup })}>Delete</button></BackupActions></td>
            </tr>)}
          </tbody></table></div>
          {!status.backups.some(backup => !backup.snapshotDeleted && backupTable(backup) === category) && <div className="px-5 py-8 text-center"><p className="m-0 text-sm font-medium text-slate-500">No backups yet</p><p className="mb-0 mt-1.5 text-xs leading-relaxed text-slate-500">{category === 'manual' ? 'Create your first backup above.' : category === 'automatic' ? 'Your scheduled backups will appear here.' : 'A safety copy will appear when you replace production.'}</p></div>}
        </section>)}
      </div>
      <p className="mt-3 text-xs text-slate-600">Before replacing production, the currently active data and photos are saved in Production change backups. Read-only previews block saves and do not create backups.</p>
      {renaming && <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); void command({ action: "rename", id: renaming.id, name: renaming.name }); }}><input aria-label="Backup name" className={button} required maxLength={80} value={renaming.name} onChange={e => setRenaming({ ...renaming, name: e.target.value })} /><button disabled={busy} className={button}>Save name</button><button type="button" className={button} onClick={() => setRenaming(null)}>Cancel</button></form>}
    </>}
    <ConfirmationDialog open={recovering} title="Recover stuck request tracking?" description="Confirm that every administrator has stopped using the app, all other tabs are closed, and no save, upload or import is running. Recovery clears tracking records; it cannot cancel a running write. Wait at least 10 minutes after stopping activity. Existing backups and student records are preserved." confirmLabel="Confirm idle and recover" destructive onCancel={() => setRecovering(false)} onConfirm={() => { setRecovering(false); void command({ action: "recover-requests", confirmedIdle: true }); }} />
    <ConfirmationDialog open={Boolean(confirmation)} title={confirmation?.action === "normalize" ? "Move live data to FS-Dance-Db?" : confirmation?.readOnly ? "View this backup read-only?" : local ? "Confirm local backup operation" : confirmation?.action === "delete" ? "Delete saved backup?" : confirmation?.action === "return" ? (status?.readOnly ? "Exit read-only preview?" : "Return everyone to original production?") : "Restore this backup into production?"} description={confirmation?.action === "normalize" ? "Save a safety backup, then copy the current live records and photos into FS-Dance-Db. This includes changes made since the backup was first activated. Application data is paused during the move. Reload open pages afterward." : confirmation?.readOnly ? "Everyone will view this backup in read-only mode. Saves are blocked. Production remains unchanged and no automatic safety backup is created. Return to production to resume normal use." : confirmation?.action === "return" && status?.readOnly ? "End the read-only preview and resume the production database you were using before it. No automatic safety backup is needed." : local ? (confirmation?.action === "delete" ? "Permanently delete this local snapshot and its saved working-copy edits? Production is unaffected." : "Switch the backup test workspace on this computer? Reload local pages before editing. Production is unaffected.") : confirmation?.action === "delete" ? "The saved backup will be permanently deleted. If its database is currently production, the live database and photos will be preserved. Otherwise its working copy will also be deleted. A backup loaded as a read-only preview cannot be deleted." : confirmation?.action === "return" ? "An automatic safety backup will be saved first. Everyone will use original production again. Edits in the current working copy are preserved separately and will not be merged." : `An automatic safety backup will be saved first. FS-Dance-Db will be replaced with ${confirmation?.backup?.name ?? "this backup"}. ${confirmation?.backup?.category === "automatic" ? "The saved snapshot will become production without creating a manual backup." : confirmation?.backup?.workingReady ? "Its previously saved edits will be retained." : "A separate copy will be verified before restoring production."} Open pages must be reloaded before saving.`} confirmLabel={confirmation?.action === "normalize" ? "Move live data" : confirmation?.readOnly ? "View read-only" : confirmation?.action === "delete" ? "Delete permanently" : confirmation?.action === "return" && status?.readOnly ? "Exit preview" : "Restore production"} destructive={confirmation?.action === "delete"} onCancel={() => setConfirmation(null)} onConfirm={() => { const value = confirmation; setConfirmation(null); if (value) void command({ action: value.action, readOnly: value.readOnly ?? false, ...(value.backup ? { id: value.backup.id } : {}) }); }} />
    <ConfirmationDialog open={recoveringDeletion !== null} title="Recover stalled deletion?" description="Stop this deletion job and unlock the controls. Files already deleted cannot be recovered by this action. Retry Delete afterward to finish removing this backup. Production will not be changed." confirmLabel="Recover deletion" onCancel={() => setRecoveringDeletion(null)} onConfirm={() => { const jobId = recoveringDeletion; setRecoveringDeletion(null); if (jobId) void command({ action: "recover-deletion", jobId }); }} />
  </section>;
}
