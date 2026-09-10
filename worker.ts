import vinextHandler from "vinext/server/fetch-handler";

const restrictedAdministrator = "croitoriu.alexandru.code@gmail.com";

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

type Permission = "dashboard" | "students" | "courses" | "payments" | "qrCodes" | "owner" | "attendance" | "presetRead";

function requiredPermission(pathname: string, method: string): Permission | null {
  if (pathname === "/api/class-attendance" || pathname.startsWith("/api/class-attendance/")) return "attendance";
  if (pathname === "/api/calendar") return "dashboard";
  if (pathname === "/administrators" || pathname.startsWith("/api/administrators")) return "owner";
  if (pathname === "/api/payment-presets" && (method === "GET" || method === "HEAD")) return "presetRead";
  if (pathname === "/payments" || pathname.startsWith("/payments/") || pathname === "/api/payment-presets" || pathname.startsWith("/api/payment-presets/")) return "payments";
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/students") || pathname.startsWith("/api/students")) return "students";
  if (pathname.startsWith("/courses") || pathname.startsWith("/api/courses")) return "courses";
  if (pathname === "/qr-codes" || pathname.startsWith("/qr-codes/") || pathname === "/api/qr-codes" || pathname.startsWith("/api/qr-codes/")) return "qrCodes";
  return null;
}

function forbidden(pathname: string) {
  const headers = { "Cache-Control": "no-store" };
  if (pathname.startsWith("/api/")) return Response.json({ error: "You do not have permission to access this resource." }, { status: 403, headers });
  return new Response("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Access denied</title><body style=\"margin:0;background:#fafaf9;color:#1e293b;font-family:system-ui,sans-serif\"><main style=\"max-width:32rem;margin:12vh auto;padding:2rem\"><h1>Access denied</h1><p>This area is available only to the authorized administrator.</p><a href=\"/settings\">Go to Settings</a></main></body></html>", { status: 403, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const publicHostname = new URL(env.PUBLIC_QR_BASE_URL).hostname;

    if (url.hostname === publicHostname && !/^\/s\/[^/]+\/?$/.test(url.pathname)) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const permission = requiredPermission(url.pathname, request.method);
    const authenticatedEmail = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
    if (permission === "owner" && !isLocalhost(url.hostname) && authenticatedEmail !== restrictedAdministrator) return forbidden(url.pathname);
    if (permission && permission !== "owner" && !isLocalhost(url.hostname) && authenticatedEmail !== restrictedAdministrator) {
      if (!authenticatedEmail) return forbidden(url.pathname);
      try {
        await env.DB.prepare("INSERT OR IGNORE INTO administrator_permissions (email) VALUES (?)").bind(authenticatedEmail).run();
        const row = await env.DB.prepare("SELECT can_dashboard, can_students, can_courses, can_payments, can_qr_codes FROM administrator_permissions WHERE email = ?").bind(authenticatedEmail).first<{ can_dashboard: number; can_students: number; can_courses: number; can_payments: number; can_qr_codes: number }>();
        const allowed = permission === "payments" ? row?.can_payments === 1 : permission === "presetRead" ? row?.can_payments === 1 || row?.can_students === 1 : permission === "attendance" ? row?.can_dashboard === 1 && row?.can_students === 1 : permission === "dashboard" ? row?.can_dashboard === 1 : permission === "students" ? row?.can_students === 1 : permission === "courses" ? row?.can_courses === 1 : row?.can_qr_codes === 1;
        if (!allowed) return forbidden(url.pathname);
      } catch (error) {
        console.error("Could not check administrator permissions", error);
        return forbidden(url.pathname);
      }
    }

    return vinextHandler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<CloudflareEnv>;
