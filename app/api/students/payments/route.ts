import { env } from "../../../lib/storage";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? 1);
  const status = url.searchParams.get("status") ?? "all";
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !["all", "pending", "given"].includes(status)) return json({ error: "Invalid payment filters." }, 400);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from > to)) return json({ error: "Enter a valid payment date range, with From on or before To." }, 400);
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (status !== "all") { conditions.push("p.given_to_school = ?"); values.push(status === "given" ? 1 : 0); }
  if (from) { conditions.push("p.paid_on >= ?"); values.push(from); }
  if (to) { conditions.push("p.paid_on <= ?"); values.push(to); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`SELECT p.id, p.student_id AS studentId, s.first_name AS firstName, s.last_name AS lastName, s.email AS studentEmail, s.picture AS studentPicture, a.name AS administratorName, a.picture AS administratorPicture, p.paid_on AS paidOn, p.amount_minor AS amountMinor, p.recorded_by AS recordedBy, p.given_to_school AS givenToSchool FROM student_payments p JOIN students s ON s.id = p.student_id LEFT JOIN admin_profiles a ON a.email = p.recorded_by ${where} ORDER BY p.paid_on DESC, p.id DESC LIMIT 10 OFFSET ?`).bind(...values, (page - 1) * 10),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM student_payments p ${where}`).bind(...values),
      env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN given_to_school = 0 THEN amount_minor ELSE 0 END), 0) AS pendingMinor, COALESCE(SUM(CASE WHEN given_to_school = 1 THEN amount_minor ELSE 0 END), 0) AS givenMinor FROM student_payments p ${where}`).bind(...values),
    ]);
    return json({ payments: results[0].results, count: (results[1].results[0] as { count: number }).count, totals: results[2].results[0] });
  } catch (error) {
    console.error("Could not load school payment transfers", error);
    return json({ error: "Could not load payments." }, 500);
  }
}

export async function PATCH(request: Request) {
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim();
  if (!email && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname)) return json({ error: "Sign in to update a payment." }, 401);
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!input || typeof input.paymentId !== "number" || !Number.isSafeInteger(input.paymentId) || input.paymentId < 1 || typeof input.studentId !== "number" || !Number.isSafeInteger(input.studentId) || input.studentId < 1 || typeof input.givenToSchool !== "boolean") return json({ error: "Invalid payment or transfer status." }, 400);
  try {
    // Update only the handover status; preserve the collector, amount and allowances.
    const result = await env.DB.prepare("UPDATE student_payments SET given_to_school = ? WHERE id = ? AND student_id = ?").bind(input.givenToSchool ? 1 : 0, input.paymentId, input.studentId).run();
    if (!result.meta.changes) return json({ error: "Payment not found." }, 404);
    return json({ givenToSchool: input.givenToSchool });
  } catch (error) {
    console.error("Could not update school payment transfer", error);
    return json({ error: "Could not save transfer status. Please retry." }, 500);
  }
}
