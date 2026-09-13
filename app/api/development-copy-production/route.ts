import { env } from "../../lib/storage";
import { copyBindings, copyRegistry, copySlots, listCopies } from "../../lib/local-copies";
import { tableColumns, type ExportTable } from "../administrators/export/route";

const ownerEmail = "croitoriu.alexandru.code@gmail.com";
const tableNames = Object.keys(tableColumns) as Array<keyof typeof tableColumns>;
const legacyEventDeleteOrder = ["event_refunds", "event_payment_handovers", "event_attendance", "event_session_changes", "event_cash_settlements", "event_requests", "event_sessions", "events"] as const;
const deleteOrder = ["payment_transfer_filters", "payment_preset_courses", "payment_course_allowances", "attendance", "practice_attendance", "student_payments", "student_courses", "course_schedule", "classes", "payment_presets", "practice_parties", "courses", "students", "qr_codes", "administrator_payment_methods", "administrator_permissions", "admin_profiles"] as const;
const insertOrder = ["admin_profiles", "administrator_permissions", "administrator_payment_methods", "payment_transfer_filters", "students", "qr_codes", "courses", "course_schedule", "student_courses", "classes", "payment_presets", "payment_preset_courses", "student_payments", "payment_course_allowances", "practice_parties", "attendance", "practice_attendance"] as const;
type DatabaseValue = string | number | null;
type DevelopmentBindings = Partial<LocalDevelopmentBindings>;

function canCopy(request: Request) {
  const hostname = new URL(request.url).hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return (local || hostname === "dev-free-spirit-dance.alexandru-croitoriu.dev") && request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase() === ownerEmail && request.headers.get("Origin") === new URL(request.url).origin;
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

async function readTables(database: D1Database) {
  const data = await database.batch(tableNames.map((name) => database.prepare(`SELECT ${tableColumns[name].map((column) => `"${column}"`).join(", ")} FROM "${name}"`)));
  return tableNames.map((name, index) => ({ name, columns: [...tableColumns[name]], rows: data[index].results as Record<string, DatabaseValue>[] })) satisfies ExportTable[];
}

function imageKey(path: unknown) {
  const prefix = "/api/student-images/";
  if (typeof path !== "string" || !path.startsWith(prefix)) return null;
  try {
    const key = decodeURIComponent(path.slice(prefix.length));
    return /^(student-|admin-)/.test(key) ? key : null;
  } catch { return null; }
}

async function copyImages(source: R2Bucket, target: R2Bucket, tables: ExportTable[]) {
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

async function clearImages(bucket: R2Bucket) {
  for (;;) {
    const page = await bucket.list({ limit: 100 });
    if (!page.objects.length) return;
    await bucket.delete(page.objects.map((object) => object.key));
  }
}

async function replaceDatabase(target: D1Database, tables: ExportTable[]) {
  const existing = await target.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${legacyEventDeleteOrder.map(() => "?").join(", ")})`).bind(...legacyEventDeleteOrder).all<{ name: string }>();
  const legacyTables = new Set(existing.results.map((row) => row.name));
  const rows = new Map(tables.map((table) => [table.name, table.rows as Record<string, DatabaseValue>[]]));
  const statements = [
    ...legacyEventDeleteOrder.filter((name) => legacyTables.has(name)).map((name) => `DELETE FROM "${name}"`),
    "UPDATE practice_attendance SET donation_amount_minor = NULL, donation_paid_on = NULL, donation_notes = '', donation_recorded_by = NULL, donation_recorded_at = NULL, donation_received_method = '', donation_given_to_school = 0 WHERE donation_amount_minor IS NOT NULL",
    ...deleteOrder.map((name) => `DELETE FROM "${name}"`),
    ...insertOrder.flatMap((name) => insertStatements(name, rows.get(name) ?? []).map((statement) => statement.slice(0, -1))),
  ];
  await target.batch(statements.map((statement) => target.prepare(statement)));
}

export async function POST(request: Request) {
  const bindings = env as DevelopmentBindings;
  // These bindings exist exclusively in vite's local-development configuration.
  // The deployed Worker has no route capable of copying or writing production data.
  if (!bindings.WORKING_DB || !bindings.WORKING_IMAGES || !bindings.PRODUCTION_DB || !bindings.PRODUCTION_IMAGES) return new Response(null, { status: 404 });
  if (!canCopy(request)) return Response.json({ error: "Only the main administrator can create a local production copy." }, { status: 403 });
  const registry = await copyRegistry(bindings.WORKING_DB);
  let reserved: string | null = null;
  try {
    for (const id of copySlots) {
      if (!copyBindings(bindings, id)) continue;
      const result = await registry.prepare("INSERT OR IGNORE INTO local_database_copies (id,name,created_at,ready) VALUES (?,?,?,0)").bind(id, `Production copy ${new Date().toLocaleString("en-GB", { timeZone: "Europe/Bucharest" })}`, new Date().toISOString()).run();
      if (result.meta.changes) { reserved = id; break; }
    }
    if (!reserved) return Response.json({ error: "All eight local copy slots are in use." }, { status: 409 });
    const target = copyBindings(bindings, reserved)!;
    const tables = await readTables(bindings.PRODUCTION_DB);
    // Retain a recoverable snapshot of the previous working records before replacement.
    const backupKey = `database-backups/${crypto.randomUUID()}.json`;
    await target.images.put(backupKey, JSON.stringify({ tables: await readTables(target.db) }), { httpMetadata: { contentType: "application/json" } });
    const images = await copyImages(bindings.PRODUCTION_IMAGES, target.images, tables);
    await replaceDatabase(target.db, tables);
    await registry.prepare("UPDATE local_database_copies SET ready=1 WHERE id=?").bind(reserved).run();
    return Response.json({ id: reserved, copies: await listCopies(registry), copied: tables.reduce((count, table) => count + table.rows.length, 0), imagesCopied: images.copied, imagesMissing: images.missing, backupKey }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (reserved) await registry.prepare("DELETE FROM local_database_copies WHERE id=? AND ready=0").bind(reserved).run();
    console.error("Could not create local production copy", error);
    return Response.json({ error: "Could not create the local production copy. Database replacement was rolled back; some images may have been copied. Restart development if the working-copy schema is not ready." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const bindings = env as DevelopmentBindings;
  if (!bindings.WORKING_DB) return new Response(null, { status: 404 });
  if (!canCopy(request)) return new Response(null, { status: 403 });
  const input = await request.json().catch(() => null) as { id?: unknown; name?: unknown } | null;
  if (!input || typeof input.id !== "string" || typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80) return Response.json({ error: "Enter a database name of 1–80 characters." }, { status: 400 });
  const registry = await copyRegistry(bindings.WORKING_DB);
  const result = await registry.prepare("UPDATE local_database_copies SET name=? WHERE id=? AND ready=1").bind(input.name.trim(), input.id).run();
  if (!result.meta.changes) return new Response(null, { status: 404 });
  return Response.json({ copies: await listCopies(registry) }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const bindings = env as DevelopmentBindings;
  if (!bindings.WORKING_DB || !bindings.CATALOG_DB || !bindings.CATALOG_IMAGES) return new Response(null, { status: 404 });
  if (!canCopy(request)) return new Response(null, { status: 403 });
  const input = await request.json().catch(() => null) as { source?: unknown } | null;
  const sourceId = typeof input?.source === "string" ? input.source : "";
  const source = copyBindings(bindings, sourceId);
  const copies = await listCopies(bindings.WORKING_DB);
  if (!source || !copies.some((copy) => copy.id === sourceId)) return Response.json({ error: "Choose a saved production copy." }, { status: 400 });
  try {
    const tables = await readTables(source.db);
    // Catalog is a local-only store. This never reads from or writes to remote production.
    await clearImages(bindings.CATALOG_IMAGES);
    const images = await copyImages(source.images, bindings.CATALOG_IMAGES, tables);
    await replaceDatabase(bindings.CATALOG_DB, tables);
    return Response.json({ replaced: true, copied: tables.reduce((count, table) => count + table.rows.length, 0), imagesCopied: images.copied, imagesMissing: images.missing }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not replace Catalog from local production copy", error);
    return Response.json({ error: "Could not replace Catalog from the local production copy. The production database was not changed." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const bindings = env as DevelopmentBindings;
  if (!bindings.WORKING_DB) return new Response(null, { status: 404 });
  if (!canCopy(request)) return new Response(null, { status: 403 });
  const input = await request.json().catch(() => null) as { id?: unknown } | null;
  const target = typeof input?.id === "string" ? copyBindings(bindings, input.id) : null;
  if (!target) return Response.json({ error: "Choose a saved production copy. Catalog cannot be deleted." }, { status: 400 });
  const registry = await copyRegistry(bindings.WORKING_DB);
  const found = await registry.prepare("SELECT id FROM local_database_copies WHERE id=? AND ready IN (1,2)").bind(input!.id).first();
  if (!found) return Response.json({ error: "Copy not found." }, { status: 404 });
  try {
    // Keep the slot reserved until both records and images have been removed.
    await registry.prepare("UPDATE local_database_copies SET ready=2 WHERE id=?").bind(input!.id).run();
    await target.db.batch([
      target.db.prepare("UPDATE practice_attendance SET donation_amount_minor=NULL, donation_paid_on=NULL, donation_notes='', donation_recorded_by=NULL, donation_recorded_at=NULL, donation_received_method='', donation_given_to_school=0 WHERE donation_amount_minor IS NOT NULL"),
      ...deleteOrder.map(name => target.db.prepare(`DELETE FROM "${name}"`)),
    ]);
    // Restart listing after each deletion; this also makes a failed cleanup retryable.
    for (;;) {
      const page = await target.images.list({ limit: 100 });
      if (!page.objects.length) break;
      await target.images.delete(page.objects.map(object => object.key));
    }
    await registry.prepare("DELETE FROM local_database_copies WHERE id=? AND ready=2").bind(input!.id).run();
    const headers = new Headers({ "Cache-Control": "no-store" });
    const selected = /(?:^|;\s*)fsd-storage=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1];
    if (selected === input!.id) headers.set("Set-Cookie", `fsd-storage=catalog; Path=/; HttpOnly; SameSite=Strict${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
    return Response.json({ deleted: true, copies: await listCopies(registry) }, { headers });
  } catch {
    return Response.json({ error: "Copy cleanup could not finish. Retry deleting this copy to finish removing its records and images." }, { status: 500 });
  }
}
