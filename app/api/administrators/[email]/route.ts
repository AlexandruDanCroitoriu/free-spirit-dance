import { env } from "cloudflare:workers";
import { serialize, type PermissionRow } from "../route";

export async function PATCH(request: Request, context: { params: Promise<{ email: string }> }) {
  const email = decodeURIComponent((await context.params).email).trim().toLowerCase();
  const input = await request.json().catch(() => null) as { dashboard?: unknown; students?: unknown; courses?: unknown } | null;
  if (!input || typeof input.dashboard !== "boolean" || typeof input.students !== "boolean" || typeof input.courses !== "boolean") return Response.json({ error: "All permissions are required." }, { status: 400 });
  try {
    const result = await (env as unknown as CloudflareEnv).DB.prepare("UPDATE administrator_permissions SET can_dashboard = ?, can_students = ?, can_courses = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ? RETURNING email, can_dashboard, can_students, can_courses").bind(input.dashboard ? 1 : 0, input.students ? 1 : 0, input.courses ? 1 : 0, email).first<PermissionRow>();
    if (!result) return Response.json({ error: "Administrator not found." }, { status: 404 });
    return Response.json(serialize(result));
  } catch (error) { console.error("Could not update administrator", error); return Response.json({ error: "Could not update administrator." }, { status: 500 }); }
}
