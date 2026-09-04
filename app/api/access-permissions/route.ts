import { env } from "cloudflare:workers";

const ownerEmail = "croitoriu.alexandru.code@gmail.com";

export async function GET(request: Request) {
  const hostname = new URL(request.url).hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase() ?? "";
  const owner = email === ownerEmail;
  if (owner) return Response.json({ dashboard: true, students: true, courses: true, administrators: true });
  if (local) return Response.json({ dashboard: true, students: true, courses: true, administrators: true });
  try {
    const db = (env as unknown as CloudflareEnv).DB;
    if (email) await db.prepare("INSERT OR IGNORE INTO administrator_permissions (email) VALUES (?)").bind(email).run();
    const row = await db.prepare("SELECT can_dashboard, can_students, can_courses FROM administrator_permissions WHERE email = ?").bind(email).first<{ can_dashboard: number; can_students: number; can_courses: number }>();
    return Response.json({ dashboard: row?.can_dashboard === 1, students: row?.can_students === 1, courses: row?.can_courses === 1, administrators: false });
  } catch (error) {
    console.error("Could not load access permissions", error);
    return Response.json({ dashboard: false, students: false, courses: false, administrators: false }, { status: 500 });
  }
}
