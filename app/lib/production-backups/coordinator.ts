import { DurableObject } from "cloudflare:workers";
import { initialControl, localToUtc, nextWeekly, sixMonthsAfter, type Backup, type Control, type Job } from "./model";

// Only control metadata passes through this object; database queries and image
// bodies go directly to their storage services. Synchronous SQLite transactions
// serialize admission and switching without holding an input gate over network I/O.
export class ProductionBackupCoordinator extends DurableObject<CloudflareEnv> {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, started_at TEXT NOT NULL)");
    if (!this.read<Control>("control")) this.write("control", initialControl());
  }
  private read<T>(key: string): T | undefined {
    const row = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM records WHERE key = ?", key).toArray()[0];
    return row ? JSON.parse(row.value) as T : undefined;
  }
  private write(key: string, value: unknown) { this.ctx.storage.sql.exec("INSERT INTO records VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value)); }
  private control() { return this.read<Control>("control")!; }
  private backups() { return this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM records WHERE key LIKE 'backup:%' ORDER BY key DESC").toArray().map(r => JSON.parse(r.value) as Backup); }
  status() {
    const control = this.control();
    return { ...control, backups: this.backups().sort((a,b) => b.createdAt.localeCompare(a.createdAt)), requests: this.pending() };
  }
  pending() { return this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM requests").one().count; }
  enter(generation: string | null, mutation: boolean) {
    return this.ctx.storage.transactionSync(() => {
      const control = this.control();
      if (control.maintenance) return { error: "Database maintenance is in progress. Please try again shortly.", status: 503 };
      if (mutation && generation !== String(control.generation)) return { error: "The active database changed, or this page is out of date. Reload before saving.", status: 409 };
      const backup = control.active === "production" ? null : this.read<Backup>(`backup:${control.active}`);
      if (control.active !== "production" && (!backup?.databaseId || !backup.workingReady)) return { error: "The selected working database is unavailable.", status: 503 };
      const ticket = crypto.randomUUID();
      this.ctx.storage.sql.exec("INSERT INTO requests VALUES (?, ?)", ticket, new Date().toISOString());
      return { ticket, generation: control.generation, active: control.active, databaseId: backup?.databaseId };
    });
  }
  leave(ticket: string) { this.ctx.storage.sql.exec("DELETE FROM requests WHERE id = ?", ticket); }
  recoverRequests() {
    return this.ctx.storage.transactionSync(() => {
      const control = this.control();
      if (control.job || control.maintenance) throw new Error("Wait for the current backup operation to finish before recovery.");
      const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
      const recent = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM requests WHERE started_at > ?", cutoff).one().count;
      if (recent) throw new Error("Requests are still recent. Close other application tabs, stop all saves and imports, then wait 10 minutes before recovery.");
      const count = this.pending();
      this.ctx.storage.sql.exec("DELETE FROM requests");
      // Invalidate old pages before admitting any subsequent saves.
      this.write("control", { ...control, generation: control.generation + 1 });
      this.write(`recovery:${crypto.randomUUID()}`, { recoveredAt: new Date().toISOString(), count });
      return count;
    });
  }
  reserve(kind: Job["kind"], id: string, name: string, actor: string, generation?: number) {
    return this.ctx.storage.transactionSync(() => {
      const control = this.control();
      if (control.job) throw new Error("Another backup operation is still running.");
      if ((kind === "activate" || kind === "return") && generation !== control.generation) throw new Error("The database selection changed. Refresh the list first.");
      if (kind === "backup") {
        id = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        this.write(`backup:${id}`, { id, name: name.trim() || `Production ${createdAt.slice(0,16).replace("T", " ")} UTC`, createdAt, expiresAt: sixMonthsAfter(createdAt), status: "creating", bytes: 0, photos: 0, schema: "" } satisfies Backup);
      } else if (kind !== "return") {
        const backup = this.read<Backup>(`backup:${id}`);
        if (!backup) throw new Error("Backup not found.");
        if (control.active === id) throw new Error("Return to original production before changing or deleting this copy.");
        if (kind === "activate" && (backup.status !== "ready" || Date.parse(backup.expiresAt) <= Date.now())) throw new Error("Choose a ready, unexpired backup.");
        if (kind === "delete") this.write(`backup:${id}`, { ...backup, status: "deleting" });
      }
      const job: Job = { id: crypto.randomUUID(), kind, backupId: id, actor, startedAt: new Date().toISOString() };
      this.write("control", { ...control, job });
      return job;
    });
  }
  rename(id: string, name: string) {
    const backup = this.read<Backup>(`backup:${id}`);
    if (!backup || !name.trim() || name.length > 80) throw new Error("Enter a backup name of 1–80 characters.");
    this.write(`backup:${id}`, { ...backup, name: name.trim() });
  }
  schedule(input: { enabled: boolean; weekday: number; time: string; once: string | null }) {
    const control = this.control();
    const next = nextWeekly(Date.now(), input.weekday, input.time);
    const once = input.once ? localToUtc(input.once) : null;
    if (once && Date.parse(once) <= Date.now()) throw new Error("Choose a future date and time.");
    this.write("control", { ...control, schedule: { ...input, next, once } });
  }
  tick(now: number) {
    const control = this.control();
    if (control.job) return control.job;
    const { schedule } = control;
    if ((schedule.enabled && Date.parse(schedule.next) <= now) || (schedule.once && Date.parse(schedule.once) <= now)) {
      const job = this.reserve("backup", "", "", "schedule");
      this.write("control", { ...this.control(), schedule: { ...schedule, next: nextWeekly(now, schedule.weekday, schedule.time), once: schedule.once && Date.parse(schedule.once) <= now ? null : schedule.once } });
      return job;
    }
    const expired = this.backups().find(b => b.id !== control.active && Date.parse(b.expiresAt) <= now);
    return expired ? this.reserve("delete", expired.id, "", "retention") : null;
  }
  lock(jobId: string) {
    const control = this.control();
    if (control.job?.id !== jobId) throw new Error("Backup job is no longer current.");
    this.write("control", { ...control, maintenance: jobId });
    return this.pending();
  }
  backup(id: string) {
    const backup = this.read<Backup>(`backup:${id}`);
    if (!backup) throw new Error("Backup not found.");
    return backup;
  }
  updateBackup(jobId: string, fields: Partial<Backup>) {
    const control = this.control();
    if (control.job?.id !== jobId) throw new Error("Backup job is no longer current.");
    const backup = this.backup(control.job.backupId);
    this.write(`backup:${backup.id}`, { ...backup, ...fields, id: backup.id });
  }
  switchDatabase(jobId: string, active: string) {
    const control = this.control();
    if (control.job?.id !== jobId || control.maintenance !== jobId || this.pending()) throw new Error("Database requests have not drained.");
    if (active !== "production" && !this.backup(active).workingReady) throw new Error("Working copy is not ready.");
    if (control.active !== active) this.write("control", { ...control, active, generation: control.generation + 1 });
  }
  finish(jobId: string, failed = false, failureMessage?: string) {
    const control = this.control();
    if (control.job?.id !== jobId) return;
    const job = control.job;
    if (failed && job.kind !== "return") {
      const backup = this.backup(job.backupId);
      this.write(`backup:${backup.id}`, { ...backup, status: job.kind === "backup" ? "failed" : job.kind === "delete" ? "failed" : backup.status, error: failureMessage ?? "Operation failed. Check the Cloudflare Workflow before retrying." });
    }
    if (!failed && job.kind === "delete") this.ctx.storage.sql.exec("DELETE FROM records WHERE key = ?", `backup:${job.backupId}`);
    this.write(`audit:${job.id}`, { ...job, finishedAt: new Date().toISOString(), failed });
    // Tickets are never expired speculatively: an interrupted request may still
    // have an in-flight write. A leaked ticket blocks future maintenance safely.
    this.write("control", { ...control, maintenance: null, job: null });
  }
}
