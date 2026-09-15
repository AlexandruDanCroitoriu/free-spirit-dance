import { ProductionBackupCoordinator } from "./coordinator";
import { copyBindings, copyRegistry, copySlots } from "../local-copies";
import { readTables, readHistoricalAbsences, clearImages, replaceDatabase } from "../local-database-transfer";
import type { Job } from "./model";

type LocalEnv = CloudflareEnv & Partial<LocalDevelopmentBindings> & { LOCAL_STORAGE_ENABLED?: string };
export class LocalBackupCoordinator extends ProductionBackupCoordinator {
  private running = new Set<string>();
  private requireLocal() {
    const env = this.env as LocalEnv;
    if (env.LOCAL_STORAGE_ENABLED !== "true" || !env.CATALOG_DB || !env.CATALOG_IMAGES || !env.WORKING_DB || !env.LOCAL_BACKUP_BUCKET) throw new Error("Local backup storage is not configured.");
    return { env, catalog: env.CATALOG_DB, images: env.CATALOG_IMAGES, registry: env.WORKING_DB, bucket: env.LOCAL_BACKUP_BUCKET };
  }
  async ensureAlarm() {
    this.requireLocal();
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
  async alarm() {
    this.requireLocal();
    // Schedule the next check before work, so a failed operation does not stop scheduling.
    await this.ctx.storage.setAlarm(Date.now() + 60000);
    const status = this.status();
    if (status.job) {
      if (!this.running.has(status.job.id)) this.finish(status.job.id, true, "Local backup was interrupted by a development-server restart. Retry the operation.");
      return;
    }
    const job = this.tick(Date.now());
    if (job) await this.runLocalJob(job);
  }
  async runLocalJob(job: Job) {
    const { env, catalog, images, registry, bucket } = this.requireLocal();
    if (this.status().job?.id !== job.id) throw new Error("Local job is no longer current.");
    if (this.running.has(job.id)) throw new Error("Local backup operation is already running.");
    this.running.add(job.id);
    try {
      this.lock(job.id);
      // Never clear active request tickets on a timer.
      for (let attempt = 0; this.pending() && attempt < 60; attempt++) await new Promise(resolve => setTimeout(resolve, 1000));
      if (this.pending()) throw new Error("Local requests did not finish. Retry after they stop.");
      const prefix = `snapshots/${job.backupId}/`;
      if (job.kind === "backup") {
        const tables = await readTables(catalog);
        const history = await readHistoricalAbsences(catalog);
        const content = JSON.stringify({ version: 1, tables, history });
        await bucket.put(`${prefix}database.json`, content);
        let cursor: string | undefined, photos = 0, bytes = new TextEncoder().encode(content).length;
        do {
          const page = await images.list({ cursor, limit: 100 });
          for (const object of page.objects) {
            const image = await images.get(object.key);
            if (!image) throw new Error("A local image is missing.");
            const saved = await bucket.put(`${prefix}images/${object.key}`, image.body, { httpMetadata: image.httpMetadata });
            if (saved.etag !== image.etag) throw new Error("Local image checksum mismatch.");
            photos++; bytes += saved.size;
          }
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        this.updateBackup(job.id, { status: "ready", schema: "local-transfer-v1", photos, bytes });
        if (job.actor === "schedule") this.updateBackup(job.id, { name: `Local Catalog ${new Date().toISOString().slice(0,16)} UTC` });
      } else if (job.kind === "activate") {
        const backup = this.backup(job.backupId);
        let slot = backup.databaseId;
        await copyRegistry(registry);
        if (!slot) {
          for (const candidate of copySlots) {
            if (!copyBindings(env, candidate)) continue;
            const result = await registry.prepare("INSERT OR IGNORE INTO local_database_copies (id,name,created_at,ready) VALUES (?,?,?,3)").bind(candidate, `Local backup ${backup.id}`, backup.createdAt).run();
            if (result.meta.changes) { slot = candidate; break; }
          }
          if (!slot) throw new Error("All eight local copy slots are in use. Delete an unused local copy first.");
          this.updateBackup(job.id, { databaseId: slot });
        }
        const target = copyBindings(env, slot);
        if (!target) throw new Error("Local working-copy slot is unavailable.");
        if (!backup.workingReady) {
          const object = await bucket.get(`${prefix}database.json`);
          if (!object) throw new Error("Local snapshot is missing.");
          const snapshot = await object.json<{ version: number; tables: Awaited<ReturnType<typeof readTables>>; history: Awaited<ReturnType<typeof readHistoricalAbsences>> }>();
          if (snapshot.version !== 1) throw new Error("Unsupported local snapshot version.");
          await clearImages(target.images);
          let cursor: string | undefined;
          do {
            const page = await bucket.list({ prefix: `${prefix}images/`, cursor, limit: 100 });
            for (const object of page.objects) {
              const image = await bucket.get(object.key);
              if (!image) throw new Error("Local snapshot photo is missing.");
              await target.images.put(object.key.slice(`${prefix}images/`.length), image.body, { httpMetadata: image.httpMetadata });
            }
            cursor = page.truncated ? page.cursor : undefined;
          } while (cursor);
          await replaceDatabase(target.db, snapshot.tables, snapshot.history);
          this.updateBackup(job.id, { workingReady: true, error: undefined });
        }
        this.switchDatabase(job.id, backup.id);
      } else if (job.kind === "return") this.switchDatabase(job.id, "production");
      else {
        const backup = this.backup(job.backupId);
        if (backup.databaseId && !this.preserveProductionOnDelete(job.id)) {
          const target = copyBindings(env, backup.databaseId);
          if (!target) throw new Error("Local working-copy slot is unavailable.");
          await replaceDatabase(target.db, [], null);
          await clearImages(target.images);
          await registry.prepare("DELETE FROM local_database_copies WHERE id=? AND ready=3").bind(backup.databaseId).run();
        }
        for (;;) {
          const page = await bucket.list({ prefix, limit: 100 });
          if (!page.objects.length) break;
          await bucket.delete(page.objects.map(o => o.key));
        }
      }
      this.finish(job.id);
    } catch (error) {
      this.finish(job.id, true, "Local backup failed. Check the development server and available copy slots, then retry.");
      throw error;
    } finally { this.running.delete(job.id); }
  }
}
