import { generationScript } from './http';

type LocalEnv = CloudflareEnv & Partial<LocalDevelopmentBindings> & { LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET?: string };
const endpoint = 'https://free-spirit-dance.alexandru-croitoriu.dev/api/administrators/production-backups';

function unavailable(request: Request, message: string, status = 503): Response {
  const headers = { 'Cache-Control': 'no-store' };
  if (request.method !== 'GET' || !request.headers.get('Accept')?.includes('text/html')) return Response.json({ error: message }, { status, headers });
  const escaped = message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Production connection unavailable</title></head><body style="margin:0;background:#fafaf9;color:#1e293b;font:16px/1.6 system-ui,sans-serif"><main style="max-width:36rem;margin:10vh auto;padding:2rem"><h1>Production connection unavailable</h1><p>${escaped}</p><p>Your database selection is still Production. You can open Catalog to continue working locally.</p><button id="catalog" style="padding:.75rem 1rem;cursor:pointer">Open Catalog</button><p><a href="/administrators">Open production backup controls</a></p><p id="error" role="alert"></p></main><script>document.getElementById('catalog').onclick=async function(){this.disabled=true;try{const response=await fetch('/api/development-storage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({selected:'catalog'})});if(!response.ok)throw new Error('Could not switch to Catalog. Try again.');try{localStorage.setItem('fsd-storage-changed',String(Date.now()));}catch{}location.reload();}catch(error){document.getElementById('error').textContent=error.message;this.disabled=false;}};</script></body></html>`, { status, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

// Local direct D1 access must participate in the deployed restore lock too.
// Otherwise a local save could race the atomic production replacement.
export async function localProductionRequest(request: Request, env: LocalEnv, run: () => Promise<Response>): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  const shell = new URL(request.url).pathname === '/administrators' && request.method === 'GET';
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (mutation && request.headers.get('Origin') !== new URL(request.url).origin) return new Response(null, { status: 403, headers });
  if (!env.CLOUDFLARE_ACCESS_CLIENT_ID || !env.CLOUDFLARE_ACCESS_CLIENT_SECRET || !env.LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET) {
    return unavailable(request, 'Configure the local production connection credentials before using Production.');
  }
  const command = (body: Record<string, unknown>) => fetch(endpoint, {
    method: 'POST', headers: {
      'Content-Type': 'application/json',
      'CF-Access-Client-Id': env.CLOUDFLARE_ACCESS_CLIENT_ID!,
      'CF-Access-Client-Secret': env.CLOUDFLARE_ACCESS_CLIENT_SECRET!,
      'X-FSD-Local-Backup-Bridge': env.LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET!,
    }, body: JSON.stringify(body),
  });
  let ticket: string | undefined;
  try {
    // The read-only management GET exists on older deployments too. Keep the
    // controls accessible while deploying the new admission protocol.
    const admission = shell ? await fetch(endpoint, { headers: {
      'CF-Access-Client-Id': env.CLOUDFLARE_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.CLOUDFLARE_ACCESS_CLIENT_SECRET,
      'X-FSD-Local-Backup-Bridge': env.LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET,
    } }) : await command({ action: 'enter-local-production', mutation, generation: request.headers.get('X-FSD-Generation') });
    const entry = await admission.json() as { ticket?: string; generation?: number; error?: string };
    if (!admission.ok || (!shell && !entry.ticket) || !Number.isInteger(entry.generation)) {
      const outdated = entry.error === 'Unknown backup action.';
      return unavailable(request, outdated ? 'The deployed app needs the production connection update. Deploy it, then move the current live data to FS-Dance-Db in Administrators.' : entry.error ?? 'Update the deployed application before connecting to production locally.', outdated || admission.ok ? 503 : admission.status);
    }
    ticket = entry.ticket;
    const original = await run();
    let response = new Response(original.body, original);
    response.headers.set('X-FSD-Generation', String(entry.generation));
    response.headers.set('Cache-Control', 'no-store');
    if (response.headers.get('Content-Type')?.includes('text/html')) {
      response = new HTMLRewriter().on('head', { element(element) { element.prepend(generationScript(entry.generation!), { html: true }); } }).transform(response);
    }
    return response;
  } catch (error) {
    if (ticket) throw error;
    return unavailable(request, 'Could not reach production request tracking. Check the connection and deployed version.');
  } finally {
    if (ticket) {
      const released = await command({ action: 'leave-local-production', ticket });
      if (!released.ok) throw new Error('Could not release the production request.');
    }
  }
}
