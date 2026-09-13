import { env } from "../../lib/storage";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const localAdministrator = "administrator@local";
type PaymentType = "course" | "practice_party";
type Input = { id?: unknown; collectorEmail?: unknown; fromDate?: unknown; toDate?: unknown; paymentTypes?: unknown };

function actor(request: Request) {
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase();
  return email || (localHosts.has(new URL(request.url).hostname) ? localAdministrator : null);
}
function date(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return undefined;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : undefined;
}
function parse(input: Input) {
  const collectorEmail = typeof input.collectorEmail === "string" ? input.collectorEmail.trim().toLowerCase() : "";
  const fromDate = date(input.fromDate), toDate = date(input.toDate);
  const paymentTypes = Array.isArray(input.paymentTypes) ? [...new Set(input.paymentTypes)] : [];
  if (!collectorEmail || collectorEmail.length > 254 || fromDate === undefined || toDate === undefined || (fromDate && toDate && fromDate > toDate) || !paymentTypes.length || paymentTypes.some((item) => item !== "course" && item !== "practice_party")) return null;
  return { collectorEmail, fromDate, toDate, paymentTypes: paymentTypes as PaymentType[] };
}
function filterWhere(filter: { collectorEmail: string; fromDate: string | null; toDate: string | null; paymentTypes: PaymentType[] }) {
  const conditions = ["p.recorded_by = ?"];
  const values: (string | number)[] = [filter.collectorEmail];
  if (filter.fromDate) { conditions.push("p.paid_on >= ?"); values.push(filter.fromDate); }
  if (filter.toDate) { conditions.push("p.paid_on <= ?"); values.push(filter.toDate); }
  conditions.push(`(${filter.paymentTypes.map((type) => type === "course" ? "p.purpose = 'course'" : "p.purpose = 'practice_donation'").join(" OR ")})`);
  return { where: conditions.join(" AND "), values };
}

export async function GET(request: Request) {
  const email = actor(request);
  if (!email) return json({ error: "Sign in to view saved transfer filters." }, 401);
  const id = new URL(request.url).searchParams.get("id");
  try {
    if (id !== null) {
      const filterId = Number(id);
      if (!Number.isSafeInteger(filterId) || filterId < 1) return json({ error: "Invalid saved filter." }, 400);
      const filter = await env.DB.prepare("SELECT id, collector_email AS collectorEmail, from_date AS fromDate, to_date AS toDate, payment_types AS paymentTypes FROM payment_transfer_filters WHERE id = ? AND administrator_email = ?").bind(filterId, email).first<{ id: number; collectorEmail: string; fromDate: string | null; toDate: string | null; paymentTypes: string }>();
      if (!filter) return json({ error: "Saved filter not found." }, 404);
      const clause = filterWhere({ ...filter, paymentTypes: filter.paymentTypes.split(",").filter((type): type is PaymentType => type === "course" || type === "practice_party") });
      const payments = await env.DB.prepare(`SELECT p.id, p.purpose, p.practice_id AS practiceId, p.practice_description AS practiceDescription, p.student_id AS studentId, s.first_name AS firstName, s.last_name AS lastName, s.email AS studentEmail, s.picture AS studentPicture, p.paid_on AS paidOn, p.amount_minor AS amountMinor, p.received_method AS receivedMethod, p.given_to_school AS givenToSchool FROM school_payment_records p JOIN students s ON s.id = p.student_id WHERE ${clause.where} ORDER BY p.paid_on DESC, p.id DESC`).bind(...clause.values).all<{ id: number; purpose: "course" | "practice_donation"; practiceId: number | null; practiceDescription: string | null; studentId: number; firstName: string; lastName: string; studentEmail: string | null; studentPicture: string | null; paidOn: string; amountMinor: number; receivedMethod: string; givenToSchool: number }>();
      const coursePaymentIds = payments.results.filter((payment) => payment.purpose === "course").map((payment) => payment.id);
      const allowances = coursePaymentIds.length ? await env.DB.prepare(`SELECT payment_id AS paymentId, course_name AS courseName, allowance FROM payment_course_allowances WHERE payment_id IN (${coursePaymentIds.map(() => "?").join(",")}) ORDER BY payment_id, course_name COLLATE NOCASE`).bind(...coursePaymentIds).all<{ paymentId: number; courseName: string; allowance: number }>() : { results: [] as { paymentId: number; courseName: string; allowance: number }[] };
      return json({ payments: payments.results.map((payment) => ({ ...payment, allocations: allowances.results.filter((allowance) => allowance.paymentId === payment.id) })) });
    }
    const filters = await env.DB.prepare(`SELECT f.id, f.collector_email AS collectorEmail, f.from_date AS fromDate, f.to_date AS toDate, f.payment_types AS paymentTypes, profile.name AS collectorName,
      (SELECT COALESCE(SUM(p.amount_minor), 0) FROM school_payment_records p WHERE p.recorded_by = f.collector_email AND (f.from_date IS NULL OR p.paid_on >= f.from_date) AND (f.to_date IS NULL OR p.paid_on <= f.to_date) AND ((instr(',' || f.payment_types || ',', ',course,') > 0 AND p.purpose = 'course') OR (instr(',' || f.payment_types || ',', ',practice_party,') > 0 AND p.purpose = 'practice_donation'))) AS totalMinor,
      (SELECT COUNT(*) FROM school_payment_records p WHERE p.recorded_by = f.collector_email AND (f.from_date IS NULL OR p.paid_on >= f.from_date) AND (f.to_date IS NULL OR p.paid_on <= f.to_date) AND ((instr(',' || f.payment_types || ',', ',course,') > 0 AND p.purpose = 'course') OR (instr(',' || f.payment_types || ',', ',practice_party,') > 0 AND p.purpose = 'practice_donation'))) AS paymentCount,
      (SELECT COALESCE(MIN(p.given_to_school), 0) FROM school_payment_records p WHERE p.recorded_by = f.collector_email AND (f.from_date IS NULL OR p.paid_on >= f.from_date) AND (f.to_date IS NULL OR p.paid_on <= f.to_date) AND ((instr(',' || f.payment_types || ',', ',course,') > 0 AND p.purpose = 'course') OR (instr(',' || f.payment_types || ',', ',practice_party,') > 0 AND p.purpose = 'practice_donation'))) AS allGiven
      FROM payment_transfer_filters f LEFT JOIN admin_profiles profile ON profile.email = f.collector_email WHERE f.administrator_email = ? ORDER BY f.sort_order, f.id`).bind(email).all();
    const collectors = await env.DB.prepare("SELECT directory.email, profile.name, profile.picture FROM (SELECT email FROM administrator_permissions UNION SELECT ? AS email) directory LEFT JOIN admin_profiles profile ON profile.email = directory.email ORDER BY COALESCE(NULLIF(TRIM(profile.name), ''), directory.email) COLLATE NOCASE").bind(email).all<{ email: string; name: string | null; picture: string | null }>();
    return json({ filters: filters.results, collectors: collectors.results });
  } catch (error) { console.error("Could not load saved payment transfer filters", error); return json({ error: "Could not load saved transfer filters." }, 500); }
}

export async function POST(request: Request) {
  const email = actor(request); if (!email) return json({ error: "Sign in to save a transfer filter." }, 401);
  const input = parse(await request.json().catch(() => null) as Input); if (!input) return json({ error: "Choose an administrator, valid dates, and at least one payment type." }, 400);
  try {
    await env.DB.prepare("INSERT INTO admin_profiles (email, name, picture) SELECT ?, '', NULL WHERE NOT EXISTS (SELECT 1 FROM admin_profiles WHERE email = ?)").bind(email, email).run();
    if (!await env.DB.prepare("SELECT 1 FROM admin_profiles WHERE email = ?").bind(input.collectorEmail).first()) return json({ error: "Collector not found." }, 404);
    const result = await env.DB.prepare("INSERT INTO payment_transfer_filters (administrator_email, collector_email, from_date, to_date, payment_kind, payment_types, created_at) VALUES (?, ?, ?, ?, 'course', ?, ?)").bind(email, input.collectorEmail, input.fromDate, input.toDate, input.paymentTypes.join(","), new Date().toISOString()).run();
    return json({ id: result.meta.last_row_id }, 201);
  } catch (error) { console.error("Could not save payment transfer filter", error); return json({ error: "Could not save transfer filter." }, 500); }
}

export async function PATCH(request: Request) {
  const email = actor(request); if (!email) return json({ error: "Sign in to update a transfer filter." }, 401);
  const raw = await request.json().catch(() => null) as Input | null; const input = raw && parse(raw); const id = raw?.id;
  if (!input || !Number.isSafeInteger(id) || (id as number) < 1) return json({ error: "Invalid saved filter." }, 400);
  try { if (!await env.DB.prepare("SELECT 1 FROM admin_profiles WHERE email = ?").bind(input.collectorEmail).first()) return json({ error: "Collector not found." }, 404); const result = await env.DB.prepare("UPDATE payment_transfer_filters SET collector_email = ?, from_date = ?, to_date = ?, payment_types = ? WHERE id = ? AND administrator_email = ?").bind(input.collectorEmail, input.fromDate, input.toDate, input.paymentTypes.join(","), id, email).run(); return result.meta.changes ? json({ id }) : json({ error: "Saved filter not found." }, 404); } catch (error) { console.error("Could not update payment transfer filter", error); return json({ error: "Could not update transfer filter." }, 500); }
}

export async function DELETE(request: Request) {
  const email = actor(request); if (!email) return json({ error: "Sign in to remove a transfer filter." }, 401);
  const id = Number(new URL(request.url).searchParams.get("id")); if (!Number.isSafeInteger(id) || id < 1) return json({ error: "Invalid saved filter." }, 400);
  try { const result = await env.DB.prepare("DELETE FROM payment_transfer_filters WHERE id = ? AND administrator_email = ?").bind(id, email).run(); return result.meta.changes ? json({ id }) : json({ error: "Saved filter not found." }, 404); } catch (error) { console.error("Could not remove payment transfer filter", error); return json({ error: "Could not remove transfer filter." }, 500); }
}

export async function PUT(request: Request) {
  const email = actor(request); if (!email) return json({ error: "Sign in to rearrange transfer filters." }, 401);
  const order = (await request.json().catch(() => null) as { order?: unknown } | null)?.order;
  if (!Array.isArray(order) || !order.length || order.length > 200 || order.some((id) => !Number.isSafeInteger(id) || (id as number) < 1) || new Set(order).size !== order.length) return json({ error: "Invalid report order." }, 400);
  try {
    const existing = await env.DB.prepare(`SELECT id FROM payment_transfer_filters WHERE administrator_email = ? AND id IN (${order.map(() => "?").join(",")})`).bind(email, ...(order as number[])).all<{ id: number }>();
    if (existing.results.length !== order.length) return json({ error: "One of the saved reports was not found." }, 404);
    await env.DB.batch(order.map((id, index) => env.DB.prepare("UPDATE payment_transfer_filters SET sort_order = ? WHERE id = ? AND administrator_email = ?").bind(index + 1, id, email)));
    return json({ order });
  } catch (error) { console.error("Could not rearrange payment transfer filters", error); return json({ error: "Could not rearrange saved reports." }, 500); }
}
