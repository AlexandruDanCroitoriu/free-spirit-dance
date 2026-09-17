import { env } from "../../../lib/storage";
import { serialize, type PermissionRow } from "../route";

export async function PATCH(request: Request, context: { params: Promise<{ email: string }> }) {
  const email = decodeURIComponent((await context.params).email).trim().toLowerCase();
  const input = await request.json().catch(() => null) as { dashboard?: unknown; students?: unknown; courses?: unknown; freeEvents?: unknown; practiceParties?: unknown; qrCodes?: unknown; tasks?: unknown } | null;
  if (!input || typeof input.dashboard !== "boolean" || typeof input.students !== "boolean" || typeof input.courses !== "boolean" || typeof input.freeEvents !== "boolean" || typeof input.practiceParties !== "boolean" || typeof input.qrCodes !== "boolean" || (input.tasks !== undefined && typeof input.tasks !== "boolean")) return Response.json({ error: "All permissions are required." }, { status: 400 });
  try {
    const result = await env.DB.prepare("UPDATE administrator_permissions SET can_dashboard = ?, can_students = ?, can_courses = ?, can_free_events = ?, can_practice_parties = ?, can_qr_codes = ?, can_tasks = COALESCE(?, can_tasks) WHERE email = ? RETURNING email, can_dashboard, can_students, can_courses, can_free_events, can_practice_parties, can_qr_codes, can_tasks").bind(input.dashboard ? 1 : 0, input.students ? 1 : 0, input.courses ? 1 : 0, input.freeEvents ? 1 : 0, input.practiceParties ? 1 : 0, input.qrCodes ? 1 : 0, input.tasks === undefined ? null : input.tasks ? 1 : 0, email).first<PermissionRow>();
    if (!result) return Response.json({ error: "Administrator not found." }, { status: 404 });
    return Response.json(serialize(result));
  } catch (error) { console.error("Could not update administrator", error); return Response.json({ error: "Could not update administrator." }, { status: 500 }); }
}

export async function DELETE(_request: Request, context: { params: Promise<{ email: string }> }) {
  const email = decodeURIComponent((await context.params).email).trim().toLowerCase();
  if (!email) return Response.json({ error: "Administrator email is required." }, { status: 400 });
  try {
    const result = await env.DB.prepare("DELETE FROM administrator_permissions WHERE email = ?").bind(email).run();
    if (!result.meta.changes) return Response.json({ error: "Administrator not found." }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) { console.error("Could not delete administrator", error); return Response.json({ error: "Could not delete administrator." }, { status: 500 }); }
}
