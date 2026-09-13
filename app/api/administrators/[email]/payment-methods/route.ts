import { env } from "../../../../lib/storage";

const ownerEmail = "croitoriu.alexandru.code@gmail.com";

function canManage(request: Request) {
  const hostname = new URL(request.url).hostname;
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return local || request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase() === ownerEmail;
}

function methodsFrom(input: unknown) {
  if (!Array.isArray(input) || input.length > 30 || input.some((method) => typeof method !== "string" || !method.trim() || method.trim().length > 50)) return null;
  return ["CASH", ...new Set(input.map((method) => method.trim()).filter((method) => method.toLocaleLowerCase() !== "cash"))];
}

async function emailFrom(context: { params: Promise<{ email: string }> }) {
  return decodeURIComponent((await context.params).email).trim().toLowerCase();
}

export async function GET(request: Request, context: { params: Promise<{ email: string }> }) {
  if (!canManage(request)) return Response.json({ error: "Only the main administrator can manage payment methods." }, { status: 403 });
  const email = await emailFrom(context);
  try {
    const exists = await env.DB.prepare("SELECT 1 FROM administrator_permissions WHERE email = ?").bind(email).first();
    if (!exists) return Response.json({ error: "Administrator not found." }, { status: 404 });
    const result = await env.DB.prepare("SELECT method FROM administrator_payment_methods WHERE email = ? ORDER BY method COLLATE NOCASE").bind(email).all<{ method: string }>();
    return Response.json({ paymentMethods: result.results.map((row) => row.method) });
  } catch (error) {
    console.error("Could not load administrator payment methods", error);
    return Response.json({ error: "Could not load payment methods." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ email: string }> }) {
  if (!canManage(request)) return Response.json({ error: "Only the main administrator can manage payment methods." }, { status: 403 });
  const email = await emailFrom(context);
  const input = await request.json().catch(() => null) as { paymentMethods?: unknown } | null;
  const paymentMethods = methodsFrom(input?.paymentMethods);
  if (!paymentMethods) return Response.json({ error: "Enter up to 30 payment methods, each 50 characters or fewer." }, { status: 400 });
  try {
    const exists = await env.DB.prepare("SELECT 1 FROM administrator_permissions WHERE email = ?").bind(email).first();
    if (!exists) return Response.json({ error: "Administrator not found." }, { status: 404 });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM administrator_payment_methods WHERE email = ?").bind(email),
      ...paymentMethods.map((method) => env.DB.prepare("INSERT INTO administrator_payment_methods (email, method) VALUES (?, ?)").bind(email, method)),
    ]);
    return Response.json({ paymentMethods });
  } catch (error) {
    console.error("Could not save administrator payment methods", error);
    return Response.json({ error: "Could not save payment methods." }, { status: 500 });
  }
}
