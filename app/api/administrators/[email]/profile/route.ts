import { env } from "../../../../lib/storage";

type Profile = { email: string; name: string; picture: string | null };

function imageKey(picture: string | null) {
  const prefix = "/api/student-images/";
  if (!picture?.startsWith(prefix)) return null;
  try {
    const key = decodeURIComponent(picture.slice(prefix.length));
    return key.startsWith("admin-") ? key : null;
  } catch { return null; }
}

export async function PATCH(request: Request, context: { params: Promise<{ email: string }> }) {
  const email = decodeURIComponent((await context.params).email).trim().toLowerCase();
  const input = await request.json().catch(() => null) as { name?: unknown; picture?: unknown } | null;
  if (!email || !input || typeof input.name !== "string" || !input.name.trim()) return Response.json({ error: "A name is required." }, { status: 400 });
  if (input.name.trim().length > 100) return Response.json({ error: "Name must be 100 characters or fewer." }, { status: 400 });
  if (input.picture !== null && typeof input.picture !== "string") return Response.json({ error: "Picture must be an image URL or empty." }, { status: 400 });
  if (typeof input.picture === "string" && !imageKey(input.picture)) return Response.json({ error: "Invalid administrator image." }, { status: 400 });

  try {
    const [permission, existing] = await env.DB.batch([
      env.DB.prepare("SELECT 1 FROM administrator_permissions WHERE email = ?").bind(email),
      env.DB.prepare("SELECT picture FROM admin_profiles WHERE email = ?").bind(email),
    ]);
    if (!permission.results.length) return Response.json({ error: "Administrator not found." }, { status: 404 });
    const picture = typeof input.picture === "string" ? input.picture : null;
    const result = await env.DB.prepare("INSERT INTO admin_profiles (email, name, picture) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET name = excluded.name, picture = excluded.picture RETURNING email, name, picture").bind(email, input.name.trim(), picture).first<Profile>();
    const previousPicture = (existing.results[0] as { picture: string | null } | undefined)?.picture ?? null;
    const previousKey = imageKey(previousPicture);
    if (previousKey && previousPicture !== picture) await env.STUDENT_IMAGES.delete(previousKey);
    return Response.json(result);
  } catch (error) {
    console.error("Could not save administrator profile", error);
    return Response.json({ error: "Could not save administrator profile." }, { status: 500 });
  }
}
