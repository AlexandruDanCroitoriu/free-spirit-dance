import { env } from "../../../lib/storage";
import { tableColumns, upgradeTaskTables } from "../export/route";

const ownerEmail = "croitoriu.alexandru.code@gmail.com";
const protectedTables = new Set(["admin_profiles", "administrator_permissions", "administrator_payment_methods", "payment_transfer_filters", "task_board_state"]);
const tableNames = (Object.keys(tableColumns) as Array<keyof typeof tableColumns>).filter((name) => !protectedTables.has(name));
const insertOrder = ["task_preferences", "task_boards", "task_lists", "students", "student_profile_log", "qr_codes", "courses", "course_schedule", "student_courses", "classes", "class_change_log", "payment_presets", "payment_preset_courses", "student_payments", "payment_students", "payment_course_allowances", "practice_parties", "attendance", "free_missed_attendance", "practice_attendance", "manual_tasks", "task_courses", "task_students", "task_images"] as const;
const legacyNullableColumns: Partial<Record<keyof typeof tableColumns, readonly string[]>> = {
  students: ["picture", "birth_date"],
  qr_codes: ["image_path"],
  courses: ["start_date", "end_date", "class_cost_minor"],
  course_schedule: ["rent_cost_minor"],
  payment_presets: ["course_id"],
  classes: ["end_time", "cancelled_by", "cancelled_at", "rent_cost_minor", "rent_paid", "created_by"],
  attendance: ["recorded_at", "request_key", "request_payload", "class_id", "complimentary_by", "complimentary_at"],
  free_missed_attendance: ["notes"],
  practice_parties: ["request_hash", "last_request_key", "last_request_hash"],
  practice_attendance: ["donation_amount_minor", "donation_paid_on", "donation_recorded_by", "donation_recorded_at"],
};

type ImportedTable = { name?: unknown; columns?: unknown; rows?: unknown };
type DatabaseValue = string | number | null;
type ImportRow = Record<string, DatabaseValue>;
type GeneratedId = { id: number };
type ImportEnv = CloudflareEnv & { PRODUCTION_IMAGES?: R2Bucket };
const generatedIdTables = new Set(["task_boards", "task_lists", "students", "student_profile_log", "qr_codes", "courses", "classes", "class_change_log", "payment_presets", "student_payments", "practice_parties", "attendance", "free_missed_attendance", "practice_attendance", "manual_tasks", "task_courses", "task_students"]);
const foreignKeys: Partial<Record<keyof typeof tableColumns, Record<string, keyof typeof tableColumns>>> = {
  task_lists: { board_id: "task_boards" },
  manual_tasks: { list_id: "task_lists" },
  task_courses: { task_id: "manual_tasks", course_id: "courses" },
  task_students: { task_id: "manual_tasks", student_id: "students" },
  task_images: { task_id: "manual_tasks" },
  course_schedule: { course_id: "courses" },
  student_courses: { student_id: "students", course_id: "courses" },
  student_profile_log: { student_id: "students" },
  classes: { course_id: "courses" },
  class_change_log: { class_id: "classes" },
  payment_preset_courses: { preset_id: "payment_presets", course_id: "courses" },
  payment_presets: { course_id: "courses" },
  student_payments: { student_id: "students" },
  payment_students: { payment_id: "student_payments", student_id: "students" },
  payment_course_allowances: { payment_id: "student_payments", course_id: "courses" },
  attendance: { student_id: "students", course_id: "courses", class_id: "classes" },
  free_missed_attendance: { student_id: "students", class_id: "classes" },
  practice_attendance: { student_id: "students", practice_id: "practice_parties" },
};
const administratorReferenceColumns: Partial<Record<keyof typeof tableColumns, readonly string[]>> = {
  task_boards: ["owner_email"],
  task_preferences: ["email"],
  manual_tasks: ["created_by", "updated_by", "inbox_owner"],
  classes: ["cancelled_by", "created_by"],
  student_payments: ["recorded_by"],
  attendance: ["recorded_by", "complimentary_by"],
  free_missed_attendance: ["granted_by"],
  practice_parties: ["recorded_by"],
  practice_attendance: ["recorded_by", "donation_recorded_by"],
};

function canImport(request: Request) {
  const hostname = new URL(request.url).hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return local || request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase() === ownerEmail;
}

function validValue(value: unknown): value is DatabaseValue {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function parseTables(input: unknown): Map<string, ImportRow[]> | null {
  input = upgradeTaskTables(input);
  if (!Array.isArray(input)) return null;
  const supplied = new Map<string, ImportedTable>();
  for (const table of input) {
    if (!table || typeof table !== "object" || typeof (table as ImportedTable).name !== "string" || supplied.has((table as ImportedTable).name as string)) return null;
    supplied.set((table as ImportedTable).name as string, table as ImportedTable);
  }
  const rows = new Map<string, ImportRow[]>();
  for (const name of tableNames) {
    const table = supplied.get(name);
    const columns = tableColumns[name];
    // Pre-task exports contain all old tables but no manual_tasks table.
    if (!table && (name === "manual_tasks" || name === "free_missed_attendance" || name === "class_change_log")) { rows.set(name, []); continue; }
    if (!table || !Array.isArray(table.columns) || table.columns.length !== columns.length || table.columns.some((column, index) => column !== columns[index]) || !Array.isArray(table.rows)) return null;
    const validatedRows: ImportRow[] = [];
    for (const row of table.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row as object).length !== columns.length) return null;
      const values = columns.map((column) => {
        const value = (row as Record<string, unknown>)[column];
        // Exports created before NULL cells were omitted used empty strings instead.
        return value === "" && legacyNullableColumns[name]?.includes(column) ? null : value;
      });
      if (values.some((value) => !validValue(value))) return null;
      validatedRows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])) as ImportRow);
    }
    rows.set(name, validatedRows);
  }
  return rows;
}

function temporaryId(value: DatabaseValue): value is string {
  return typeof value === "string" && /^new:[a-z][a-z0-9_-]*$/i.test(value);
}

function tableKey(table: string, value: string) { return `${table}:${value}`; }

function mappedValue(value: DatabaseValue, table: keyof typeof tableColumns, generatedIds: Map<string, number>) {
  if (!temporaryId(value)) return value;
  const id = generatedIds.get(tableKey(table, value));
  if (id === undefined) throw new Error(`No new ${table} record is labelled ${value}.`);
  return id;
}

async function insertRows(name: typeof insertOrder[number], rows: ImportRow[], generatedIds: Map<string, number>) {
  // A numeric ID collision must never put imported private work on another board.
  if (name === 'task_boards') for (const row of rows) {
    const existing = await env.DB.prepare('SELECT id, owner_email FROM task_boards WHERE id = ? OR (owner_email IS NOT NULL AND owner_email = ?)').bind(row.id, row.owner_email).all<{id: number; owner_email: string | null}>();
    if (existing.results.some(item => item.id !== row.id || (item.owner_email?.toLowerCase() ?? null) !== (typeof row.owner_email === 'string' ? row.owner_email.toLowerCase() : null))) throw new Error('Imported task board ownership conflicts with this database.');
  }
  if (name === 'task_lists') for (const row of rows) {
    const existing = await env.DB.prepare('SELECT board_id FROM task_lists WHERE id = ?').bind(row.id).first<{board_id: number}>();
    if (existing && existing.board_id !== mappedValue(row.board_id, 'task_boards', generatedIds)) throw new Error('Imported task list belongs to another board.');
  }
  const columns = tableColumns[name];
  const references = foreignKeys[name] ?? {};
  const statements = rows.map((row) => {
    const temporary = generatedIdTables.has(name) && (row.id === null || temporaryId(row.id as DatabaseValue));
    const selectedColumns = temporary ? columns.filter((column) => column !== "id") : columns;
    const values = selectedColumns.map((column) => {
      const value = row[column] ?? null;

      return references[column] ? mappedValue(value, references[column], generatedIds) : value;
    });
    const task = name === 'manual_tasks';
    const sql = `INSERT ${task ? "" : "OR IGNORE "}INTO "${name}" (${selectedColumns.map((column) => `"${column}"`).join(", ")}) VALUES (${selectedColumns.map(() => "?").join(", ")})${task ? " ON CONFLICT DO NOTHING" : ""}${temporary ? " RETURNING id" : ""}`;
    return { temporaryId: temporary && typeof row.id === "string" ? row.id : null, statement: env.DB.prepare(sql).bind(...values) };
  });
  if (!statements.length) return;
  const batch = statements.map(({ statement }) => statement);
  const results = await env.DB.batch(batch);
  for (let index = 0; index < statements.length; index++) {
    const tag = statements[index].temporaryId;
    if (!tag) continue;
    const id = (results[index].results[0] as GeneratedId | undefined)?.id;
    if (!Number.isSafeInteger(id)) throw new Error(`Could not add the record labelled ${tag}; it may duplicate an existing record.`);
    generatedIds.set(tableKey(name, tag), id as number);
  }
}

async function ensureAuditProfiles(rows: Map<string, ImportRow[]>) {
  const emails = new Set<string>();
  for (const [name, columns] of Object.entries(administratorReferenceColumns) as Array<[keyof typeof tableColumns, readonly string[]]>) {
    for (const row of rows.get(name)!) {
      for (const column of columns) {
        const email = row[column];
        if (typeof email === "string" && email) emails.add(email);
      }
    }
  }
  if (!emails.size) return;
  // Keep permissions untouched, but retain historical “recorded by” references
  // when production data mentions an administrator who has not visited Local yet.
  await env.DB.batch([...emails].map((email) => env.DB.prepare("INSERT OR IGNORE INTO admin_profiles (email, name, picture) VALUES (?, '', NULL)").bind(email)));
}

function studentImageKey(picture: DatabaseValue) {
  const imagePath = "/api/student-images/";
  if (typeof picture !== "string" || !picture.startsWith(imagePath)) return null;
  try {
    const key = decodeURIComponent(picture.slice(imagePath.length));
    return key.startsWith("student-") ? key : null;
  } catch {
    return null;
  }
}

function qrImageKey(imagePath: DatabaseValue) {
  return typeof imagePath === "string" && imagePath.startsWith("qr-") ? imagePath : null;
}

async function copyProductionImages(rows: Map<string, ImportRow[]>) {
  const source = (env as ImportEnv).PRODUCTION_IMAGES;
  if (!source) return 0;
  const keys = new Set([
    ...rows.get("students")!.map((row) => studentImageKey(row.picture)),
    ...rows.get("qr_codes")!.map((row) => qrImageKey(row.image_path)),
    ...(rows.get("task_images") ?? []).map((row) => typeof row.object_key === "string" && row.object_key.startsWith("task-images/") ? row.object_key : null),
  ].filter((key): key is string => key !== null));
  let copied = 0;
  for (const key of keys) {
    const object = await source.get(key);
    if (!object) continue;
    await env.STUDENT_IMAGES.put(key, object.body, { httpMetadata: object.httpMetadata });
    copied++;
  }
  return copied;
}

export async function POST(request: Request) {
  if (!canImport(request)) return Response.json({ error: "Only the main administrator can import the database." }, { status: 403 });
  if (request.headers.get("Origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const rows = parseTables((await request.json().catch(() => null) as { tables?: unknown } | null)?.tables);
  if (!rows) return Response.json({ error: "Choose an unmodified database export from this app." }, { status: 400 });

  try {
    const rowCount = tableNames.reduce((total, name) => total + rows.get(name)!.length, 0);
    if (rowCount > 1000) return Response.json({ error: "This export is too large to import safely in one operation." }, { status: 413 });
    const generatedIds = new Map<string, number>();
    await ensureAuditProfiles(rows);
    for (const name of insertOrder) await insertRows(name, rows.get(name)!, generatedIds);
    let imagesCopied = 0;
    try {
      imagesCopied = await copyProductionImages(rows);
    } catch (error) {
      console.error("Could not copy imported production images", error);
    }
    return Response.json({ imported: true, imagesCopied });
  } catch (error) {
    console.error("Could not import database", error);
    return Response.json({ error: "Could not import the database. Some records may already have been added; check the development server log for details." }, { status: 400 });
  }
}
