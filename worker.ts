import { withStorage } from "./app/lib/storage";
import vinextHandler from "vinext/server/fetch-handler";

const restrictedAdministrator = "croitoriu.alexandru.code@gmail.com";

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

type Permission = "dashboard" | "students" | "courses" | "qrCodes" | "owner" | "practiceParties";

function requiredPermission(pathname: string): Permission | null {
  if (pathname === "/practice-parties" || pathname.startsWith("/practice-parties/")) return "practiceParties";
  if (pathname === "/administrators") return "owner";
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/students")) return "students";
  if (pathname.startsWith("/courses")) return "courses";
  if (pathname === "/qr-codes" || pathname.startsWith("/qr-codes/")) return "qrCodes";
  return null;
}

function forbidden(pathname: string) {
  const headers = { "Cache-Control": "no-store" };
  if (pathname.startsWith("/api/")) return Response.json({ error: "You do not have permission to access this resource." }, { status: 403, headers });
  return new Response("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Access denied</title><body style=\"margin:0;background:#fafaf9;color:#1e293b;font-family:system-ui,sans-serif\"><main style=\"max-width:32rem;margin:12vh auto;padding:2rem\"><h1>Access denied</h1><p>This area is available only to the authorized administrator.</p><a href=\"/settings\">Go to Settings</a></main></body></html>", { status: 403, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

type DevelopmentEnv = CloudflareEnv & { LOCAL_STORAGE_ENABLED?: string; LOCAL_DB?: D1Database; LOCAL_IMAGES?: R2Bucket };

const application = {
  async fetch(request: Request, env, ctx) {
    const url = new URL(request.url);
    const publicHostname = new URL(env.PUBLIC_QR_BASE_URL).hostname;

    if (url.hostname === publicHostname && !/^\/s\/[^/]+\/?$/.test(url.pathname)) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const permission = requiredPermission(url.pathname);
    const authenticatedEmail = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
    if (permission === "owner" && !isLocalhost(url.hostname) && authenticatedEmail !== restrictedAdministrator) return forbidden(url.pathname);
    if (permission && permission !== "owner" && !isLocalhost(url.hostname) && authenticatedEmail !== restrictedAdministrator) {
      if (!authenticatedEmail) return forbidden(url.pathname);
      try {
        await env.DB.prepare("INSERT OR IGNORE INTO administrator_permissions (email) VALUES (?)").bind(authenticatedEmail).run();
        const row = await env.DB.prepare("SELECT can_dashboard, can_students, can_courses, can_practice_parties, can_qr_codes FROM administrator_permissions WHERE email = ?").bind(authenticatedEmail).first<{ can_dashboard: number; can_students: number; can_courses: number; can_practice_parties: number; can_qr_codes: number }>();
        const allowed = permission === "practiceParties" ? row?.can_practice_parties === 1 : permission === "dashboard" ? row?.can_dashboard === 1 : permission === "students" ? row?.can_students === 1 : permission === "courses" ? row?.can_courses === 1 : row?.can_qr_codes === 1;
        if (!allowed) return forbidden(url.pathname);
      } catch (error) {
        console.error("Could not check administrator permissions", error);
        return forbidden(url.pathname);
      }
    }

    return vinextHandler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<CloudflareEnv>;

// Scope database and image bindings to each request, including route modules.
export default {
  async fetch(request: Request, env: DevelopmentEnv, ctx) {
    const url = new URL(request.url);
    const development = env.LOCAL_STORAGE_ENABLED === "true";
    // Plain localhost is the main administrator during local development.
    // Tunnel requests still require the identity supplied by Cloudflare Access.
    if (development && isLocalhost(url.hostname)) {
      const headers = new Headers(request.headers);
      headers.set("cf-access-authenticated-user-email", restrictedAdministrator);
      request = new Request(request, { headers });
    }
    const email = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
    const canSwitch = development && email === restrictedAdministrator &&
      (url.hostname === "dev-free-spirit-dance.alexandru-croitoriu.dev" || isLocalhost(url.hostname));
    const selected = canSwitch && /(?:^|;\s*)fsd-storage=production(?:;|$)/.test(request.headers.get("Cookie") ?? "") ? "production" : "local";
    if (url.pathname === "/api/development-storage") {
      const headers = new Headers({ "Cache-Control": "no-store" });
      if (!canSwitch) return Response.json({ available: false }, { headers });
      if (request.method === "GET") return Response.json({ available: true, selected }, { headers });
      if (request.method !== "POST") return new Response(null, { status: 405, headers });
      if (request.headers.get("Origin") !== url.origin) return new Response(null, { status: 403, headers });
      const input = await request.json().catch(() => null) as { selected?: unknown } | null;
      if (input?.selected !== "local" && input?.selected !== "production") return Response.json({ error: "Choose Local or Production." }, { status: 400, headers });
      headers.set("Set-Cookie", `fsd-storage=${input.selected}; Path=/; HttpOnly; SameSite=Strict${url.protocol === "https:" ? "; Secure" : ""}`);
      return Response.json({ available: true, selected: input.selected }, { headers });
    }
    if (!development) return application.fetch(request, env, ctx);
    if (!env.LOCAL_DB || !env.LOCAL_IMAGES) return new Response("Local storage is not configured.", { status: 503 });
    const scoped = selected === "production" ? env : { ...env, DB: env.LOCAL_DB, STUDENT_IMAGES: env.LOCAL_IMAGES };
    const response = await withStorage(scoped, () => application.fetch(request, scoped, ctx));
    // Image URLs and record IDs can overlap across stores; never reuse cached data.
    const result = new Response(response.body, response);
    result.headers.set("Cache-Control", "no-store");
    result.headers.append("Vary", "Cookie");
    return result;
  },
} satisfies ExportedHandler<DevelopmentEnv>;
