import { productionImages } from "./production-storage";
import { withStorage } from "../storage";
import { prefixedImages, workingDatabase } from "./cloud";
import type { Job } from "./model";

const owner = "croitoriu.alexandru.code@gmail.com";
const headers = { "Cache-Control": "no-store" };

export async function localBackupBridgeAuthorized(request: Request, env: CloudflareEnv) {
  const expected = env.LOCAL_BACKUP_BRIDGE_SECRET;
  const received = request.headers.get("X-FSD-Local-Backup-Bridge");
  if (!expected || !received) return false;
  const encode = new TextEncoder();
  const [expectedHash, receivedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(expected)),
    crypto.subtle.digest("SHA-256", encode.encode(received)),
  ]);
  const left = new Uint8Array(expectedHash);
  const right = new Uint8Array(receivedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
export function backupsConfigured(env: CloudflareEnv) {
  return Boolean(env.PRODUCTION_BACKUPS && env.BACKUP_WORKFLOW && env.BACKUP_BUCKET && env.BACKUP_ACCOUNT_ID && env.BACKUP_API_TOKEN);
}
export async function launchJob(env: CloudflareEnv, job: Job) {
  // Creation is retried by the minute trigger when the API response is lost.
  try { await env.BACKUP_WORKFLOW.create({ id: job.id, params: job }); }
  catch { /* An existing instance or a lost create response is checked below. */ }
  const instance = await env.BACKUP_WORKFLOW.get(job.id);
  const status = await instance.status();
  if (["errored", "terminated", "complete"].includes(status.status)) await env.PRODUCTION_BACKUPS.getByName("production").finish(job.id, status.status !== "complete");
}
export async function backupManagement(request: Request, env: CloudflareEnv, development: boolean): Promise<Response | null> {
  const url = new URL(request.url);
  const management = url.pathname === "/api/administrators/production-backups";
  const statusRoute = url.pathname === "/api/production-database";
  if (!management && !statusRoute) return null;
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  const localBridge = management && await localBackupBridgeAuthorized(request, env);
  if ((!email && !localBridge) || (management && email !== owner && !localBridge)) return Response.json({ error: "Access denied." }, { status: 403, headers });
  if (development || !env.PRODUCTION_BACKUPS || (management && !backupsConfigured(env))) return Response.json({ available: false, reason: development ? "Production backups are managed on the deployed application." : "Cloudflare backup storage and credentials have not been configured." }, { headers });
  const coordinator = env.PRODUCTION_BACKUPS.getByName("production");
  if (request.method === "GET") {
    const status = await coordinator.status();
    if (management && url.searchParams.has('download')) {
      const id = url.searchParams.get('id');
      const backup = status.backups.find(item => item.id === id);
      if (!backup || backup.snapshotDeleted || backup.status !== 'ready' || Date.parse(backup.expiresAt) <= Date.now()) return Response.json({ error: 'Choose a ready, unexpired saved backup.' }, { status: 404, headers });
      const prefix = `snapshots/${backup.id}/`;
      const mode = url.searchParams.get('download');
      if (mode === 'metadata') return Response.json({ name: backup.name, schema: backup.schema, photos: backup.photos }, { headers });
      if (mode === 'images') {
        const page = await env.BACKUP_BUCKET.list({ prefix: `${prefix}images/`, cursor: url.searchParams.get('cursor') || undefined, limit: 100 });
        return Response.json({ keys: page.objects.map(object => object.key.slice(`${prefix}images/`.length)), cursor: page.truncated ? page.cursor : '' }, { headers });
      }
      const key = url.searchParams.get('key');
      if (mode !== 'sql' && (mode !== 'image' || !key || key.includes('..') || key.startsWith('/'))) return Response.json({ error: 'Invalid backup download.' }, { status: 400, headers });
      const object = await env.BACKUP_BUCKET.get(mode === 'sql' ? `${prefix}database.sql` : `${prefix}images/${key}`);
      if (!object) return Response.json({ error: 'Backup file is missing. The backup may have been deleted.' }, { status: 404, headers });
      if (mode === 'sql' && object.size > 24 * 1024 * 1024) return Response.json({ error: 'This backup is too large for local import.' }, { status: 413, headers });
      return new Response(object.body, { headers: { ...headers, 'Content-Type': mode === 'sql' ? 'application/sql' : object.httpMetadata?.contentType ?? 'application/octet-stream' } });
    }
    if (!management) return Response.json({ available: true, readOnly: Boolean(status.readOnly), active: status.active, generation: status.generation, maintenance: Boolean(status.maintenance), name: status.active === "production" ? "FS-Dance-Db" : status.backups.find(b => b.id === status.active)?.name ?? "Backup working copy" }, { headers });
    // Database IDs and actor identities stay in the control store.
    return Response.json({ available: true, ...status, backups: status.backups.map(({ databaseId: _databaseId, ...backup }) => backup) }, { headers });
  }
  if (!management || request.method !== "POST") return new Response(null, { status: 405, headers });
  if ((!localBridge && request.headers.get("Origin") !== url.origin) || !request.headers.get("Content-Type")?.startsWith("application/json")) return new Response(null, { status: 403, headers });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return new Response(null, { status: 413, headers });
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (!input || typeof input !== "object") throw new Error("Invalid request.");
    if (input.action === 'local-production-status') {
      if (!localBridge) throw new Error('Invalid local production request.');
      return Response.json({ generation: (await coordinator.status()).generation }, { headers });
    } else if (input.action === 'enter-local-production') {
      if (!localBridge || typeof input.mutation !== 'boolean' || !(input.generation === null || typeof input.generation === 'string')) throw new Error('Invalid local production request.');
      const entry = await coordinator.enter(input.generation, input.mutation);
      if ('error' in entry) return Response.json({ error: entry.error }, { status: entry.status, headers });
      if (entry.active !== 'production') {
        await coordinator.leave(entry.ticket);
        return Response.json({ error: 'Exit the production preview or move current live data to FS-Dance-Db before connecting locally.' }, { status: 409, headers });
      }
      return Response.json({ ticket: entry.ticket, generation: entry.generation }, { headers });
    } else if (input.action === 'leave-local-production') {
      if (!localBridge || typeof input.ticket !== 'string' || !/^[a-f0-9-]{36}$/.test(input.ticket)) throw new Error('Invalid local production request.');
      await coordinator.leave(input.ticket);
    } else if (input.action === 'retry-restore') {
      const current = await coordinator.status();
      if (!current.job?.productionRestore || input.jobId !== current.job.id) throw new Error('The restore job changed. Refresh first.');
      const instance = await env.BACKUP_WORKFLOW.get(current.job.id);
      const state = await instance.status();
      if (!['errored', 'terminated', 'complete'].includes(state.status)) throw new Error('The restore is still running. Wait before retrying.');
      await instance.restart();
    } else if (input.action === "recover-deletion") {
      const current = await coordinator.status();
      const job = current.job;
      if (!job || job.kind !== "delete" || input.jobId !== job.id) throw new Error("The deletion job changed. Refresh the list first.");
      if (Date.now() - Date.parse(job.startedAt) < 5 * 60_000) throw new Error("Allow five minutes for deletion before recovering it.");
      const instance = await env.BACKUP_WORKFLOW.get(job.id);
      let state = await instance.status();
      if (!["complete", "errored", "terminated"].includes(state.status)) {
        await instance.terminate();
        state = await instance.status();
      }
      if (!["complete", "errored", "terminated"].includes(state.status)) throw new Error("Deletion is still stopping. Try recovery again shortly.");
      // Never release the reservation until the old execution has stopped.
      await coordinator.finish(job.id, state.status !== "complete", "Deletion was interrupted. Choose Delete again to finish removing any remaining files.");
    } else if (input.action === "recover-requests") {
      if (input.confirmedIdle !== true) throw new Error("Confirm that every administrator has stopped using the application.");
      await coordinator.recoverRequests();
    } else if (input.action === "schedule") {
      if (typeof input.enabled !== "boolean" || typeof input.weekday !== "number" || typeof input.time !== "string" || !(input.once === null || typeof input.once === "string")) throw new Error("Invalid schedule.");
      await coordinator.schedule({ enabled: input.enabled, weekday: input.weekday, time: input.time, once: input.once });
    } else if (input.action === "rename") {
      if (typeof input.id !== "string" || typeof input.name !== "string") throw new Error("Invalid backup name.");
      await coordinator.rename(input.id, input.name);
    } else if (["backup", "activate", "return", "delete", "normalize"].includes(String(input.action))) {
      if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 80)) throw new Error("Backup names can have at most 80 characters.");
      if (input.id !== undefined && (typeof input.id !== "string" || !/^[a-f0-9-]{36}$/.test(input.id))) throw new Error("Invalid backup.");
      if (input.sourceBackupId !== undefined && (typeof input.sourceBackupId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.sourceBackupId))) throw new Error('Invalid source backup.');
      if (input.readOnly !== undefined && typeof input.readOnly !== 'boolean') throw new Error('Invalid backup mode.');
      const job = await coordinator.reserve(input.action as Job["kind"], String(input.id ?? ""), String(input.name ?? ""), email ?? "local development service token", typeof input.generation === "number" ? input.generation : undefined, input.sourceBackupId as string | undefined, input.readOnly === true);
      // The reservation persists even if Workflow creation temporarily fails.
      await launchJob(env, job).catch(() => console.error("Backup job launch will be retried by the scheduler."));
    } else throw new Error("Unknown backup action.");
    return Response.json({ accepted: true }, { status: 202, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Backup operation failed." }, { status: 400, headers });
  }
}

// Install before the app's scripts: every tab retains the generation of the
// document it loaded, including fetch calls made before React effects run.
export function generationScript(generation: number) {
  return `<script>window.__fsdGeneration=${generation};(()=>{const original=window.fetch;window.fetch=function(input,init){const url=new URL(input instanceof Request?input.url:String(input),location.href);const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();if(url.origin===location.origin&&url.pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(method)){const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));headers.set('X-FSD-Generation',String(window.__fsdGeneration));init={...init,headers};}return original.call(this,input,init);};})();</script>`;
}
export function productionRequest(request: Request, env: CloudflareEnv, run: (request: Request, env: CloudflareEnv) => Promise<Response>, ctx?: Pick<ExecutionContext, "waitUntil">): Promise<Response> {
  const operation = trackedProductionRequest(request, env, run);
  // Keep admission, handler and cleanup alive if the browser disconnects.
  ctx?.waitUntil(operation.then(() => undefined, () => undefined));
  return operation;
}
async function trackedProductionRequest(request: Request, env: CloudflareEnv, run: (request: Request, env: CloudflareEnv) => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (mutation && request.headers.get("Origin") !== url.origin) return new Response(null, { status: 403, headers });
  const coordinator = env.PRODUCTION_BACKUPS.getByName("production");
  // HTML shells remain available during maintenance, so the owner can see the
  // running job. All data/image routes participate in request draining.
  const shellAsset = url.pathname.startsWith("/_next/") || ["/logo.svg", "/favicon.ico"].includes(url.pathname);
  const dataRequest = url.pathname !== "/administrators" && !shellAsset;
  const entry = dataRequest ? await coordinator.enter(request.headers.get("X-FSD-Generation"), mutation) : await coordinator.status();
  if (!dataRequest && mutation && 'readOnly' in entry && entry.readOnly) return Response.json({ error: 'This backup is read-only. Changes cannot be saved.' }, { status: 403, headers });
  if ("error" in entry) return Response.json({ error: entry.error }, { status: entry.status, headers: { ...headers, "Retry-After": "5" } });
  try {
    const backup = "backups" in entry ? entry.backups.find(b => b.id === entry.active) : null;
    const databaseId = "databaseId" in entry ? entry.databaseId : backup?.databaseId;
    const scoped = entry.active === "production" ? { ...env, STUDENT_IMAGES: await productionImages(env.DB, env.STUDENT_IMAGES) } : { ...env, DB: workingDatabase(env, databaseId!), STUDENT_IMAGES: prefixedImages(env.BACKUP_BUCKET, `working/${entry.active}/`) };
    let response = await withStorage(scoped, () => run(request, scoped));
    response = new Response(response.body, response);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-FSD-Generation", String(entry.generation));
    if (response.headers.get("Content-Type")?.includes("text/html")) {
      response = new HTMLRewriter().on("head", { element(element) { element.prepend(generationScript(entry.generation), { html: true }); } }).transform(response);
    }
    return response;
  } finally {
    if ("ticket" in entry && entry.ticket) await coordinator.leave(entry.ticket);
  }
}
