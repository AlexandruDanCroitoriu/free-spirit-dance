import { copyBindings, listCopies } from "../local-copies";
import { withStorage } from "../storage";
import { generationScript } from "./http";
import type { Job } from "./model";
import { saveBackupLocally } from './local-download';

type LocalEnv = CloudflareEnv & Partial<LocalDevelopmentBindings> & { LOCAL_STORAGE_ENABLED?: string; LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET?: string };
const owner = "croitoriu.alexandru.code@gmail.com";
const headers = { "Cache-Control": "no-store" };
const productionBackupsUrl = "https://free-spirit-dance.alexandru-croitoriu.dev/api/administrators/production-backups";

/** Proxy the live backup card only from the local Worker. Browser code never
 * receives either the Access service-token secret or the bridge secret. */
export async function localProductionBackupManagement(request: Request, env: LocalEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/development-production-backups") return null;
  if (env.LOCAL_STORAGE_ENABLED !== "true") return new Response(null, { status: 404, headers });
  if (request.headers.get("cf-access-authenticated-user-email") !== owner) return new Response(null, { status: 403, headers });
  if (!env.CLOUDFLARE_ACCESS_CLIENT_ID || !env.CLOUDFLARE_ACCESS_CLIENT_SECRET || !env.LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET) {
    return Response.json({ available: false, reason: "Set the local production-backup credentials in .env, then restart npm run dev." }, { headers });
  }
  if (request.method !== "GET" && request.method !== "POST") return new Response(null, { status: 405, headers });
  if (request.method === "POST" && (request.headers.get("Origin") !== url.origin || !request.headers.get("Content-Type")?.startsWith("application/json"))) return new Response(null, { status: 403, headers });
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body && body.length > 4096) return new Response(null, { status: 413, headers });
  try {
    if (body) {
      const input = JSON.parse(body) as Record<string, unknown>;
      if (input.action === 'save-local') {
        if (typeof input.id !== 'string') return Response.json({ error: 'Choose a saved backup.' }, { status: 400, headers });
        try {
          const result = await saveBackupLocally(env, input.id, async params => {
            const response = await fetch(`${productionBackupsUrl}?${new URLSearchParams(params)}`, {
              headers: {
                'CF-Access-Client-Id': env.CLOUDFLARE_ACCESS_CLIENT_ID!,
                'CF-Access-Client-Secret': env.CLOUDFLARE_ACCESS_CLIENT_SECRET!,
                'X-FSD-Local-Backup-Bridge': env.LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET!,
              },
              signal: AbortSignal.timeout(60_000),
            });
            if (!response.ok) throw new Error('Could not download this backup. Check that the production backup updates are deployed and the backup is still available.');
            if (params.download === 'sql' && !response.headers.get('Content-Type')?.includes('application/sql')) throw new Error('Deploy the backup download update to production first.');
            return response;
          });
          return Response.json(result, { headers });
        } catch (error) {
          // Do not expose SQL errors, which may contain private student data.
          return Response.json({ error: error instanceof Error && !/SQL|D1_|sqlite/i.test(error.message) ? error.message : 'Could not restore the backup locally. Check its schema compatibility and available local storage.' }, { status: 400, headers });
        }
      }
    }
    const response = await fetch(productionBackupsUrl, {
      method: request.method,
      headers: {
        "CF-Access-Client-Id": env.CLOUDFLARE_ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": env.CLOUDFLARE_ACCESS_CLIENT_SECRET,
        "X-FSD-Local-Backup-Bridge": env.LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body,
    });
    return new Response(response.body, { status: response.status, headers: { "Cache-Control": "no-store", "Content-Type": response.headers.get("Content-Type") ?? "application/json" } });
  } catch {
    return Response.json({ available: false, reason: "Could not reach the deployed production backup service." }, { status: 502, headers });
  }
}
export async function localBackupManagement(request: Request, env: LocalEnv, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const statusRoute = url.pathname === "/api/production-database";
  if (url.pathname !== "/api/administrators/local-backups" && !statusRoute) return null;
  if (env.LOCAL_STORAGE_ENABLED !== "true") return statusRoute ? null : new Response(null, { status: 404 });
  if (request.headers.get("cf-access-authenticated-user-email") !== owner) return new Response(null, { status: 403 });
  if (!env.LOCAL_BACKUPS || !env.LOCAL_BACKUP_BUCKET) return Response.json({ available: false, reason: "Restart the development server to enable local backups." }, { headers });
  const coordinator = env.LOCAL_BACKUPS.getByName("local-tests");
  if (statusRoute) {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const selected = /(?:^|;\s*)fsd-storage=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1];
    if (selected === "production") return Response.json({ available: false }, { headers });
    const status = await coordinator.status();
    return Response.json({ available: true, local: true, active: selected === "backup-test" ? status.active : "production", name: selected === "backup-test" ? status.backups.find(b => b.id === status.active)?.name ?? "Local Catalog" : "Local development", generation: status.generation, maintenance: Boolean(status.maintenance) }, { headers });
  }
  await coordinator.ensureAlarm();
  if (request.method === "GET") return Response.json({ available: true, ...await coordinator.status() }, { headers });
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (request.headers.get("Origin") !== url.origin || !request.headers.get("Content-Type")?.startsWith("application/json")) return new Response(null, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 4096) return new Response(null, { status: 413 });
    const input = JSON.parse(text) as Record<string, unknown>;
    if (!input || typeof input !== "object") throw new Error("Invalid request.");
    if (input.action === "schedule") {
      if (typeof input.enabled !== "boolean" || typeof input.weekday !== "number" || typeof input.time !== "string" || !(input.once === null || typeof input.once === "string")) throw new Error("Invalid schedule.");
      await coordinator.schedule({ enabled: input.enabled, weekday: input.weekday, time: input.time, once: input.once });
    } else if (input.action === "rename") {
      if (typeof input.id !== "string" || typeof input.name !== "string") throw new Error("Invalid name.");
      await coordinator.rename(input.id, input.name);
    } else if (["backup", "activate", "return", "delete"].includes(String(input.action))) {
      if (input.name !== undefined && (typeof input.name !== "string" || input.name.length > 80)) throw new Error("Backup names can have at most 80 characters.");
      if (input.id !== undefined && (typeof input.id !== "string" || !/^[a-f0-9-]{36}$/.test(input.id))) throw new Error("Invalid local backup.");
      const job = await coordinator.reserve(input.action as Job["kind"], String(input.id ?? ""), String(input.name ?? "Local Catalog backup"), owner, typeof input.generation === "number" ? input.generation : undefined);
      ctx.waitUntil(coordinator.runLocalJob(job).catch(() => console.error("Local backup operation failed; see the local backup card.")));
      const response = Response.json({ accepted: true }, { status: 202, headers });
      if (job.kind === "activate" || job.kind === "return") response.headers.set("Set-Cookie", `fsd-storage=backup-test; Path=/; HttpOnly; SameSite=Strict${url.protocol === "https:" ? "; Secure" : ""}`);
      return response;
    } else throw new Error("Unknown local backup action.");
    return Response.json({ accepted: true }, { headers });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Local backup operation failed." }, { status: 400, headers }); }
}

export async function localBackupRequest(request: Request, env: LocalEnv, selected: string, run: (scoped: LocalEnv) => Promise<Response>) {
  const coordinator = env.LOCAL_BACKUPS.getByName("local-tests");
  if (selected !== "catalog" && selected !== "backup-test" && (!env.WORKING_DB || !(await listCopies(env.WORKING_DB)).some(copy => copy.id === selected))) return Response.json({ error: "Local database is unavailable. Select Catalog." }, { status: 503, headers });
  const url = new URL(request.url);
  // Only API calls touch local storage; the HTML shell must remain accessible.
  const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if (mutation && request.headers.get("Origin") !== url.origin) return new Response(null, { status: 403 });
  const track = url.pathname.startsWith("/api/");
  const entry = track ? await coordinator.enter(request.headers.get("X-FSD-Generation"), mutation) : await coordinator.status();
  if ("error" in entry) return Response.json({ error: entry.error }, { status: entry.status, headers });
  let choice = selected;
  if (selected === "backup-test") {
    const backup = "backups" in entry ? entry.backups.find(b => b.id === entry.active) : null;
    choice = entry.active === "production" ? "catalog" : ("databaseId" in entry ? entry.databaseId : backup?.databaseId) ?? "";
  }
  const copy = copyBindings(env, choice);
  const scoped = choice === "catalog" ? { ...env, DB: env.CATALOG_DB!, STUDENT_IMAGES: env.CATALOG_IMAGES!, PRODUCTION_IMAGES: selected === "backup-test" ? undefined : env.PRODUCTION_IMAGES ?? env.STUDENT_IMAGES } : copy ? { ...env, DB: copy.db, STUDENT_IMAGES: copy.images } : null;
  try {
    if (!scoped) return Response.json({ error: "Local backup working copy is unavailable." }, { status: 503, headers });
    const response = await withStorage(scoped, () => run(scoped));
    return localGenerationResponse(response, entry.generation);
  } finally { if ("ticket" in entry && entry.ticket) await coordinator.leave(entry.ticket); }
}
export function localGenerationResponse(response: Response, generation: number) {
  response = new Response(response.body, response);
  response.headers.set("Cache-Control", "no-store");
  if (response.headers.get("Content-Type")?.includes("text/html")) response = new HTMLRewriter().on("head", { element(element) { element.prepend(generationScript(generation), { html: true }); } }).transform(response);
  return response;
}
