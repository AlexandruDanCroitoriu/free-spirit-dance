import { env } from "../../../lib/storage";

const ownerEmail = "croitoriu.alexandru.code@gmail.com";
// Keep this list aligned with migrations. D1's local development runtime blocks
// PRAGMA table_info, so the export cannot discover columns at request time.
export const tableColumns = {
  admin_profiles: ["email", "name", "picture"],
  administrator_payment_methods: ["email", "method"],
  administrator_permissions: ["email", "can_dashboard", "can_students", "can_courses", "can_qr_codes", "can_practice_parties"],
  attendance: ["id", "student_id", "course_id", "course_name", "attended_at", "recorded_by", "recorded_at", "notes", "request_key", "request_payload", "class_id", "complimentary", "complimentary_by", "complimentary_at"],
  classes: ["id", "course_id", "class_date", "start_time", "end_time", "cancelled", "cancelled_by", "cancelled_at", "rent_cost_minor", "rent_paid"],
  course_schedule: ["id", "course_id", "day_of_week", "start_time", "end_time", "rent_cost_minor"],
  courses: ["id", "name", "start_date", "end_date", "class_cost_minor"],
  payment_course_allowances: ["payment_id", "course_id", "course_name", "allowance"],
  payment_preset_courses: ["preset_id", "course_id", "allowance"],
  payment_presets: ["id", "name", "amount_minor", "course_id"],
  practice_attendance: ["id", "student_id", "practice_id", "recorded_by", "recorded_at", "notes", "donation_amount_minor", "donation_paid_on", "donation_notes", "donation_recorded_by", "donation_recorded_at", "donation_given_to_school", "donation_received_method"],
  practice_parties: ["id", "starts_at", "starts_utc", "duration_minutes", "cancelled", "revision", "recorded_by", "recorded_at", "request_key", "request_hash", "last_request_key", "last_request_hash"],
  qr_codes: ["id", "slug", "name", "destination_url", "active", "image_mode", "image_path", "module_shape", "foreground_color", "eye_shape", "eye_color", "logo_size", "logo_shape"],
  student_courses: ["student_id", "course_id"],
  student_payments: ["id", "student_id", "paid_on", "amount_minor", "notes", "recorded_by", "recorded_at", "request_key", "request_payload", "given_to_school", "received_method"],
  students: ["id", "first_name", "last_name", "email", "phone", "picture", "active", "birth_date"],
} as const;

type TableRow = Record<string, unknown>;
export type ExportTable = { name: string; columns: string[]; rows: TableRow[] };

function canExport(request: Request) {
  const hostname = new URL(request.url).hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  return local || email === ownerEmail;
}

export async function readExportTables() {
  const tables = Object.entries(tableColumns);
  const data = await env.DB.batch(tables.map(([name]) => env.DB.prepare(`SELECT * FROM "${name}"`)));
  return tables.map(([name, columns], index) => ({ name, columns: [...columns], rows: data[index].results as TableRow[] })) satisfies ExportTable[];
}

export async function GET(request: Request) {
  if (!canExport(request)) return Response.json({ error: "Only the main administrator can export the database." }, { status: 403 });
  try {
    return Response.json({ tables: await readExportTables() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not export database", error);
    return Response.json({ error: "Could not export the database." }, { status: 500 });
  }
}
