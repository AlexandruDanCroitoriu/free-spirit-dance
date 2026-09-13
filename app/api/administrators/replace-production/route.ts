import { env } from "../../../lib/storage";
import { tableColumns, type ExportTable } from "../export/route";

const ownerEmail = "croitoriu.alexandru.code@gmail.com";
const tableNames = Object.keys(tableColumns) as Array<keyof typeof tableColumns>;
const legacyEventDeleteOrder = ["event_refunds", "event_payment_handovers", "event_attendance", "event_session_changes", "event_cash_settlements", "event_requests", "event_sessions", "events"] as const;
const deleteOrder = ["payment_preset_courses", "payment_course_allowances", "attendance", "practice_attendance", "student_payments", "student_courses", "course_schedule", "classes", "payment_presets", "practice_parties", "courses", "students", "qr_codes", "administrator_payment_methods", "administrator_permissions", "admin_profiles"] as const;
const insertOrder = ["admin_profiles", "administrator_permissions", "administrator_payment_methods", "students", "qr_codes", "courses", "course_schedule", "student_courses", "classes", "payment_presets", "payment_preset_courses", "student_payments", "payment_course_allowances", "practice_parties", "attendance", "practice_attendance"] as const;
type DatabaseValue = string | number | null;
type DevelopmentBindings = CloudflareEnv & Partial<LocalDevelopmentBindings>;

function canReplace(request: Request) {
  return request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase() === ownerEmail &&
    request.headers.get("Origin") === new URL(request.url).origin;
}

function validValue(value: unknown): value is DatabaseValue {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function parseTables(input: unknown): Map<keyof typeof tableColumns, Record<string, DatabaseValue>[]> | null {
  if (!Array.isArray(input)) return null;
  const supplied = new Map<string, ExportTable>();
  for (const table of input) {
    if (!table || typeof table !== "object" || typeof (table as ExportTable).name !== "string" || supplied.has((table as ExportTable).name)) return null;
    supplied.set((table as ExportTable).name, table as ExportTable);
  }
  const result = new Map<keyof typeof tableColumns, Record<string, DatabaseValue>[]>();
  for (const name of tableNames) {
    const table = supplied.get(name);
    const columns = tableColumns[name];
    if (!table || !Array.isArray(table.columns) || table.columns.length !== columns.length || table.columns.some((column, index) => column !== columns[index]) || !Array.isArray(table.rows)) return null;
    const rows: Record<string, DatabaseValue>[] = [];
    for (const row of table.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== columns.length) return null;
      const values = columns.map((column) => (row as Record<string, unknown>)[column]);
      if (values.some((value) => !validValue(value))) return null;
      rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])) as Record<string, DatabaseValue>);
    }
    result.set(name, rows);
  }
  return result;
}

function sqlValue(value: DatabaseValue) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function insertStatements(name: keyof typeof tableColumns, rows: Record<string, DatabaseValue>[]) {
  if (!rows.length) return [];
  const columns = tableColumns[name];
  const prefix = `INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES `;
  const statements: string[] = [];
  let values: string[] = [];
  let length = prefix.length + 1;
  for (const row of rows) {
    const value = `(${columns.map((column) => sqlValue(row[column])).join(", ")})`;
    if (values.length && length + value.length + 1 > 90_000) {
      statements.push(prefix + values.join(", ") + ";");
      values = [];
      length = prefix.length + 1;
    }
    values.push(value);
    length += value.length + 1;
  }
  statements.push(prefix + values.join(", ") + ";");
  return statements;
}

function imageKey(path: DatabaseValue) {
  const prefix = "/api/student-images/";
  if (typeof path !== "string" || !path.startsWith(prefix)) return null;
  try {
    const key = decodeURIComponent(path.slice(prefix.length));
    return /^(student-|admin-)/.test(key) ? key : null;
  } catch { return null; }
}

async function copyCatalogImages(tables: Map<keyof typeof tableColumns, Record<string, DatabaseValue>[]>, bindings: DevelopmentBindings) {
  if (!bindings.CATALOG_IMAGES) throw new Error("Catalog image storage is not configured.");
  const keys = new Set([
    ...tables.get("students")!.map((row) => imageKey(row.picture)),
    ...tables.get("admin_profiles")!.map((row) => imageKey(row.picture)),
    ...tables.get("qr_codes")!.map((row) => typeof row.image_path === "string" && row.image_path.startsWith("qr-") ? row.image_path : null),
  ].filter((key): key is string => key !== null));
  let copied = 0;
  let missing = 0;
  for (const key of keys) {
    const image = await bindings.CATALOG_IMAGES.get(key);
    if (!image) { missing++; continue; }
    await env.STUDENT_IMAGES.put(key, image.body, { httpMetadata: image.httpMetadata });
    copied++;
  }
  return { copied, missing };
}

export async function POST(request: Request) {
  const bindings = env as DevelopmentBindings;
  // CATALOG_IMAGES exists only in the local development Worker. This makes the
  // destructive endpoint unreachable on the deployed production Worker.
  if (!bindings.CATALOG_IMAGES) return new Response(null, { status: 404 });
  if (!canReplace(request)) return Response.json({ error: "Only the main administrator can replace production data." }, { status: 403 });
  const tables = parseTables((await request.json().catch(() => null) as { tables?: unknown } | null)?.tables);
  if (!tables) return Response.json({ error: "The Catalog snapshot is not valid." }, { status: 400 });

  try {
    // Copy existing local images first. Historical Catalog snapshots can retain
    // image references whose local bucket objects are unavailable; those must
    // not prevent the requested SQL replacement.
    const images = await copyCatalogImages(tables, bindings);
    // D1 batches are transactions. This avoids raw BEGIN/COMMIT statements,
    // which the local D1 runtime intentionally rejects.
    const existing = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${legacyEventDeleteOrder.map(() => "?").join(", ")})`).bind(...legacyEventDeleteOrder).all<{ name: string }>();
    const legacyTables = new Set(existing.results.map((row) => row.name));
    const statements = [
      ...legacyEventDeleteOrder.filter((name) => legacyTables.has(name)).map((name) => `DELETE FROM "${name}"`),
      // practice_attendance owns its optional donation fields. The database
      // prevents deleting attendance while a donation remains, so clear those
      // fields before deleting the old snapshot.
      "UPDATE practice_attendance SET donation_amount_minor = NULL, donation_paid_on = NULL, donation_notes = '', donation_recorded_by = NULL, donation_recorded_at = NULL, donation_received_method = '', donation_given_to_school = 0 WHERE donation_amount_minor IS NOT NULL",
      ...deleteOrder.map((name) => `DELETE FROM "${name}"`),
      ...insertOrder.flatMap((name) => insertStatements(name, tables.get(name)!).map((statement) => statement.slice(0, -1))),
    ];
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
    return Response.json({ replaced: true, ...images });
  } catch (error) {
    console.error("Could not replace production database from Catalog", error);
    const reason = error instanceof Error && error.message ? error.message.replace(/[\r\n]+/g, " ").slice(0, 300) : "an unexpected database error";
    return Response.json({ error: `Production data was not replaced: ${reason}` }, { status: 500 });
  }
}
