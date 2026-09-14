import { tableColumns, type ExportTable } from "../api/administrators/export/route";
const tableNames = Object.keys(tableColumns) as Array<keyof typeof tableColumns>;
const legacyEventDeleteOrder = ["event_refunds", "event_payment_handovers", "event_attendance", "event_session_changes", "event_cash_settlements", "event_requests", "event_sessions", "events"] as const;
const catalogAuxiliaryDeleteOrder = ["group_sheet_audit", "catalog_v2_audit", "catalog_v2_runs", "group_sheet_runs", "practica_2026_audit", "practica_2026_runs", "_fsd_catalog_import", "history_import_notes", "history_issues", "history_payment_periods", "history_source_cells", "history_unmapped_classes"] as const;
export const deleteOrder = ["payment_transfer_filters", "payment_preset_courses", "payment_course_allowances", "attendance", "practice_attendance", "student_payments", "student_courses", "course_schedule", "classes", "payment_presets", "practice_parties", "courses", "students", "qr_codes", "administrator_payment_methods", "administrator_permissions", "admin_profiles"] as const;
const insertOrder = ["admin_profiles", "administrator_permissions", "administrator_payment_methods", "payment_transfer_filters", "students", "qr_codes", "courses", "course_schedule", "student_courses", "classes", "payment_presets", "payment_preset_courses", "student_payments", "payment_course_allowances", "practice_parties", "attendance", "practice_attendance"] as const;
const historicalAbsenceColumns = ["student_id", "course_id", "class_date", "start_time"] as const;
type DatabaseValue = string | number | null;

function sqlValue(value: DatabaseValue) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function insertStatements(name: string, columns: readonly string[], rows: Record<string, DatabaseValue>[]) {
  if (!rows.length) return [];
  const prefix = `INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES `;
  const statements: string[] = [];
  // Inserting profiles triggers creation of CASH. Accept that exact composite-key
  // duplicate while retaining validation for every other table and constraint.
  const suffix = name === "administrator_payment_methods" ? " ON CONFLICT(email, method) DO NOTHING;" : ";";
  let values: string[] = [];
  let length = prefix.length + 1;
  for (const row of rows) {
    const value = `(${columns.map((column) => sqlValue(row[column])).join(", ")})`;
    if (values.length && length + value.length + 1 > 90_000) {
      statements.push(prefix + values.join(", ") + suffix);
      values = [];
      length = prefix.length + 1;
    }
    values.push(value);
    length += value.length + 1;
  }
  statements.push(prefix + values.join(", ") + suffix);
  return statements;
}

export async function readTables(database: D1Database) {
  const data = await database.batch(tableNames.map((name) => database.prepare(`SELECT ${tableColumns[name].map((column) => `"${column}"`).join(", ")} FROM "${name}"`)));
  return tableNames.map((name, index) => ({ name, columns: [...tableColumns[name]], rows: data[index].results as Record<string, DatabaseValue>[] })) satisfies ExportTable[];
}

export async function readHistoricalAbsences(database: D1Database) {
  const exists = await database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'history_absences'").first();
  if (!exists) return null;
  return (await database.prepare(`SELECT ${historicalAbsenceColumns.map((column) => `"${column}"`).join(", ")} FROM history_absences`).all<Record<string, DatabaseValue>>()).results;
}

function imageKey(path: unknown) {
  const prefix = "/api/student-images/";
  if (typeof path !== "string" || !path.startsWith(prefix)) return null;
  try {
    const key = decodeURIComponent(path.slice(prefix.length));
    return /^(student-|admin-)/.test(key) ? key : null;
  } catch { return null; }
}

export async function copyImages(source: R2Bucket, target: R2Bucket, tables: ExportTable[]) {
  const table = new Map(tables.map((item) => [item.name, item.rows]));
  const keys = new Set([
    ...(table.get("students") ?? []).map((row) => imageKey(row.picture)),
    ...(table.get("admin_profiles") ?? []).map((row) => imageKey(row.picture)),
    ...(table.get("qr_codes") ?? []).map((row) => typeof row.image_path === "string" && row.image_path.startsWith("qr-") ? row.image_path : null),
  ].filter((key): key is string => key !== null));
  let copied = 0;
  let missing = 0;
  for (const key of keys) {
    const image = await source.get(key);
    if (!image) { missing++; continue; }
    await target.put(key, image.body, { httpMetadata: image.httpMetadata });
    copied++;
  }
  return { copied, missing };
}

export async function clearImages(bucket: R2Bucket) {
  for (;;) {
    const page = await bucket.list({ limit: 100 });
    if (!page.objects.length) return;
    await bucket.delete(page.objects.map((object) => object.key));
  }
}

export async function replaceDatabase(target: D1Database, tables: ExportTable[], historicalAbsences: Record<string, DatabaseValue>[] | null) {
  const optionalDeleteTables = [...legacyEventDeleteOrder, ...catalogAuxiliaryDeleteOrder];
  const existing = await target.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${optionalDeleteTables.map(() => "?").join(", ")})`).bind(...optionalDeleteTables).all<{ name: string }>();
  const legacyTables = new Set(existing.results.map((row) => row.name));
  const historicalTable = await target.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'history_absences'").first();
  if (historicalAbsences && !historicalTable) await target.prepare("CREATE TABLE history_absences (student_id TEXT, course_id TEXT, class_date TEXT, start_time TEXT)").run();
  const rows = new Map(tables.map((table) => [table.name, table.rows as Record<string, DatabaseValue>[]]));
  const statements = [
    ...legacyEventDeleteOrder.filter((name) => legacyTables.has(name)).map((name) => `DELETE FROM "${name}"`),
    ...catalogAuxiliaryDeleteOrder.filter((name) => legacyTables.has(name)).map((name) => `DELETE FROM "${name}"`),
    "UPDATE practice_attendance SET donation_amount_minor = NULL, donation_paid_on = NULL, donation_notes = '', donation_recorded_by = NULL, donation_recorded_at = NULL, donation_received_method = '', donation_given_to_school = 0 WHERE donation_amount_minor IS NOT NULL",
    ...(historicalTable || historicalAbsences ? ["DELETE FROM history_absences"] : []),
    ...deleteOrder.map((name) => `DELETE FROM "${name}"`),
    ...insertOrder.flatMap((name) => insertStatements(name, tableColumns[name], rows.get(name) ?? []).map((statement) => statement.slice(0, -1))),
    ...insertStatements("history_absences", historicalAbsenceColumns, historicalAbsences ?? []).map((statement) => statement.slice(0, -1)),
  ];
  await target.batch(statements.map((statement) => target.prepare(statement)));
}
