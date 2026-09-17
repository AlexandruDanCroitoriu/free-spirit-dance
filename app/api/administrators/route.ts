import { env } from "../../lib/storage";

type PermissionRow = { email: string; can_dashboard: number; can_students: number; can_courses: number; can_free_events: number; can_practice_parties: number; can_qr_codes: number; can_tasks: number };
type AdministratorRow = PermissionRow & { name: string; picture: string | null };
function serialize(row: PermissionRow) { return { email: row.email, dashboard: row.can_dashboard === 1, students: row.can_students === 1, courses: row.can_courses === 1, freeEvents: row.can_free_events === 1, practiceParties: row.can_practice_parties === 1, qrCodes: row.can_qr_codes === 1, tasks: row.can_tasks === 1 }; }

export async function GET() {
  try {
    const result = await env.DB.prepare("SELECT p.email, p.can_dashboard, p.can_students, p.can_courses, p.can_free_events, p.can_practice_parties, p.can_qr_codes, p.can_tasks, COALESCE(a.name, '') AS name, a.picture FROM administrator_permissions p LEFT JOIN admin_profiles a ON a.email = p.email ORDER BY p.email COLLATE NOCASE").all<AdministratorRow>();
    return Response.json(result.results.map((row) => ({ ...serialize(row), name: row.name, picture: row.picture })));
  } catch (error) { console.error("Could not load administrators", error); return Response.json({ error: "Could not load administrators." }, { status: 500 }); }
}

export { serialize, type PermissionRow };
