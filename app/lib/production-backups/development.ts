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
