import { env } from "../../lib/storage";

type PermissionRow = { email: string; can_dashboard: number; can_students: number; can_courses: number; can_practice_parties: number; can_qr_codes: number };
function serialize(row: PermissionRow) { return { email: row.email, dashboard: row.can_dashboard === 1, students: row.can_students === 1, courses: row.can_courses === 1, practiceParties: row.can_practice_parties === 1, qrCodes: row.can_qr_codes === 1 }; }

export async function GET() {
  try {
    const result = await env.DB.prepare("SELECT email, can_dashboard, can_students, can_courses, can_practice_parties, can_qr_codes FROM administrator_permissions ORDER BY email COLLATE NOCASE").all<PermissionRow>();
    return Response.json(result.results.map(serialize));
  } catch (error) { console.error("Could not load administrators", error); return Response.json({ error: "Could not load administrators." }, { status: 500 }); }
}

export { serialize, type PermissionRow };
