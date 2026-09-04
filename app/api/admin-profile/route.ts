import { env } from "cloudflare:workers";

type AdminProfileRow = { email: string; name: string; picture: string | null };

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
    const profile = await (env as unknown as CloudflareEnv).DB.prepare("SELECT email, name, picture FROM admin_profiles WHERE email = ?").bind(email).first<AdminProfileRow>();
    return Response.json(profile ?? { email, name: "", picture: null });
  } catch (error) {
    console.error("Could not load administrator profile", error);
    return Response.json({ error: "Could not load administrator profile." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const email = authenticatedEmail(request);
  const input = await request.json().catch(() => null) as { name?: unknown; picture?: unknown } | null;
  if (!input || typeof input.name !== "string" || !input.name.trim()) return Response.json({ error: "Name is required." }, { status: 400 });
  if (input.name.trim().length > 100) return Response.json({ error: "Name must be 100 characters or fewer." }, { status: 400 });
  if (input.picture !== null && typeof input.picture !== "string") return Response.json({ error: "Picture must be an image URL or empty." }, { status: 400 });
  if (typeof input.picture === "string" && !imageKey(input.picture)) return Response.json({ error: "Invalid administrator image." }, { status: 400 });

  try {
    const bindings = env as unknown as CloudflareEnv;
    const existing = await bindings.DB.prepare("SELECT picture FROM admin_profiles WHERE email = ?").bind(email).first<{ picture: string | null }>();
    const picture = typeof input.picture === "string" ? input.picture : null;
    const profile = await bindings.DB.prepare("INSERT INTO admin_profiles (email, name, picture) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, picture = excluded.picture, updated_at = CURRENT_TIMESTAMP RETURNING email, name, picture").bind(email, input.name.trim(), picture).first<AdminProfileRow>();
    const previousKey = imageKey(existing?.picture ?? null);
    if (previousKey && existing?.picture !== picture) await bindings.STUDENT_IMAGES.delete(previousKey);
    return Response.json(profile);
  } catch (error) {
    console.error("Could not save administrator profile", error);
    return Response.json({ error: "Could not save administrator profile." }, { status: 500 });
  }
}
