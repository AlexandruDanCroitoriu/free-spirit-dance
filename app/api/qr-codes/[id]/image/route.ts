import { env } from "cloudflare:workers";

const maxImageBytes = 250_000;
const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid QR code id." }, { status: 400 });
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const extension = file instanceof File ? allowedTypes.get(file.type) : undefined;
  if (!(file instanceof File) || !extension) return Response.json({ error: "Upload a JPEG, PNG, or WebP image." }, { status: 400 });
  if (file.size > maxImageBytes) return Response.json({ error: "The compressed image is too large." }, { status: 400 });

  const bindings = env as unknown as CloudflareEnv;
  const existing = await bindings.DB.prepare("SELECT image_path FROM qr_codes WHERE id = ?").bind(id).first<{ image_path: string | null }>();
  if (!existing) return Response.json({ error: "QR code not found." }, { status: 404 });
  const key = `qr-${id}-${crypto.randomUUID()}.${extension}`;
  const imagePath = `/api/qr-code-images/${encodeURIComponent(key)}`;

  try {
    await bindings.STUDENT_IMAGES.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "private, max-age=3600" } });
    const row = await bindings.DB.prepare("UPDATE qr_codes SET image_mode = 'custom', image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING id, slug, name, destination_url, active, image_mode, image_path, created_at, updated_at")
      .bind(imagePath, id).first<Record<string, unknown>>();
    if (!row) {
      await bindings.STUDENT_IMAGES.delete(key);
      return Response.json({ error: "QR code not found." }, { status: 404 });
    }
    const oldKey = existing.image_path?.split("/").pop();
    if (oldKey?.startsWith("qr-")) await bindings.STUDENT_IMAGES.delete(oldKey).catch((error) => {
      console.error(JSON.stringify({ message: "Could not remove previous QR code image", error: error instanceof Error ? error.message : String(error), id }));
    });
    return Response.json({
      id: row.id, slug: row.slug, name: row.name, destinationUrl: row.destination_url,
      redirectUrl: `${bindings.PUBLIC_QR_BASE_URL.replace(/\/$/, "")}/s/${row.slug}`,
      active: row.active === 1, imageMode: row.image_mode, imageUrl: row.image_path,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
  } catch (error) {
    await bindings.STUDENT_IMAGES.delete(key).catch(() => undefined);
    console.error(JSON.stringify({ message: "Could not upload QR code image", error: error instanceof Error ? error.message : String(error), id }));
    return Response.json({ error: "Could not upload QR code image." }, { status: 500 });
  }
}
