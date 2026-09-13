import { env } from "../../lib/storage";

type AdminProfileRow = { email: string; name: string; picture: string | null };
type AdminProfile = AdminProfileRow & { paymentMethods: string[] };
const paymentMethods = (input: unknown) => Array.isArray(input) && input.length <= 30 && input.every((method) => typeof method === "string" && method.trim().length > 0 && method.trim().length <= 50) ? [...new Set(input.map((method) => method.trim()))] : null;

function authenticatedEmail(request: Request) {
  return request.headers.get("cf-access-authenticated-user-email")?.trim().toLowerCase() || "administrator@local";
}

function imageKey(picture: string | null) {
  const prefix = "/api/student-images/";
  if (!picture?.startsWith(prefix)) return null;
  try {
    const key = decodeURIComponent(picture.slice(prefix.length));
    return key.startsWith("admin-") ? key : null;
  } catch { return null; }
}

export async function GET(request: Request) {
  const email = authenticatedEmail(request);
  try {
    const [profile, methods] = await env.DB.batch([env.DB.prepare("SELECT email, name, picture FROM admin_profiles WHERE email = ?").bind(email), env.DB.prepare("SELECT method FROM administrator_payment_methods WHERE email = ? ORDER BY method COLLATE NOCASE").bind(email)]);
    return Response.json({ ...(profile.results[0] as AdminProfileRow | undefined ?? { email, name: "", picture: null }), paymentMethods: (methods.results as { method: string }[]).map((item) => item.method) } satisfies AdminProfile);
  } catch (error) {
    console.error("Could not load administrator profile", error);
    return Response.json({ error: "Could not load administrator profile." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const email = authenticatedEmail(request);
  const input = await request.json().catch(() => null) as { name?: unknown; picture?: unknown; paymentMethods?: unknown } | null;
  if (!input || typeof input.name !== "string" || !input.name.trim()) return Response.json({ error: "Name is required." }, { status: 400 });
  if (input.name.trim().length > 100) return Response.json({ error: "Name must be 100 characters or fewer." }, { status: 400 });
  if (input.picture !== null && typeof input.picture !== "string") return Response.json({ error: "Picture must be an image URL or empty." }, { status: 400 });
  if (typeof input.picture === "string" && !imageKey(input.picture)) return Response.json({ error: "Invalid administrator image." }, { status: 400 });
  const suppliedMethods = paymentMethods(input.paymentMethods);
  if (!suppliedMethods) return Response.json({ error: "Enter up to 30 payment methods, each 50 characters or fewer." }, { status: 400 });
  const methods = ["CASH", ...suppliedMethods.filter((method) => method.toLocaleLowerCase() !== "cash")];

  try {
    const bindings = env;
    const existing = await bindings.DB.prepare("SELECT picture FROM admin_profiles WHERE email = ?").bind(email).first<{ picture: string | null }>();
    const picture = typeof input.picture === "string" ? input.picture : null;
    const statements = [bindings.DB.prepare("INSERT INTO admin_profiles (email, name, picture) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, picture = excluded.picture").bind(email, input.name.trim(), picture), bindings.DB.prepare("DELETE FROM administrator_payment_methods WHERE email = ?").bind(email), ...methods.map((method) => bindings.DB.prepare("INSERT INTO administrator_payment_methods (email, method) VALUES (?, ?)").bind(email, method)), bindings.DB.prepare("SELECT email, name, picture FROM admin_profiles WHERE email = ?").bind(email)];
    const results = await bindings.DB.batch(statements);
    const profile = results.at(-1)!.results[0] as AdminProfileRow;
    const previousKey = imageKey(existing?.picture ?? null);
    if (previousKey && existing?.picture !== picture) await bindings.STUDENT_IMAGES.delete(previousKey);
    return Response.json({ ...profile, paymentMethods: methods } satisfies AdminProfile);
  } catch (error) {
    console.error("Could not save administrator profile", error);
    return Response.json({ error: "Could not save administrator profile." }, { status: 500 });
  }
}
