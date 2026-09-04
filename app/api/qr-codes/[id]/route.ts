import { env } from "cloudflare:workers";

type QrCodeRow = {
  id: number;
  slug: string;
  name: string;
  destination_url: string;
  active: number;
  image_mode: "none" | "logo" | "custom";
  image_path: string | null;
  created_at: string;
  updated_at: string;
};

function validate(input: unknown) {
  if (!input || typeof input !== "object") return "QR code details are required.";
  const qrCode = input as Record<string, unknown>;
  if (typeof qrCode.name !== "string" || !qrCode.name.trim()) return "Name is required.";
  if (qrCode.name.trim().length > 100) return "Name must be 100 characters or fewer.";
  if (typeof qrCode.destinationUrl !== "string" || !qrCode.destinationUrl.trim()) return "Destination URL is required.";
  if (qrCode.destinationUrl.trim().length > 2048) return "Destination URL is too long.";
  if (typeof qrCode.active !== "boolean") return "Active state is required.";
  if (!["none", "logo", "custom"].includes(String(qrCode.imageMode))) return "Choose a valid QR code image.";
  try {
    const destination = new URL(qrCode.destinationUrl.trim());
    if (!['http:', 'https:'].includes(destination.protocol)) return "Destination URL must use HTTP or HTTPS.";
    if (destination.username || destination.password) return "Destination URL cannot contain credentials.";
  } catch { return "Enter a valid destination URL."; }
  return null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid QR code id." }, { status: 400 });
  const input = await request.json().catch(() => null);
  const validationError = validate(input);
  if (validationError) return Response.json({ error: validationError }, { status: 400 });
  const qrCode = input as { name: string; destinationUrl: string; active: boolean; imageMode: "none" | "logo" | "custom" };

  try {
    const bindings = env as unknown as CloudflareEnv;
    const existing = await bindings.DB.prepare("SELECT image_mode, image_path FROM qr_codes WHERE id = ?").bind(id).first<{ image_mode: string; image_path: string | null }>();
    if (!existing) return Response.json({ error: "QR code not found." }, { status: 404 });
    const keepCustom = qrCode.imageMode === "custom" && existing.image_mode === "custom" && existing.image_path;
    const imageMode = keepCustom ? "custom" : qrCode.imageMode === "custom" ? "none" : qrCode.imageMode;
    const imagePath = keepCustom ? existing.image_path : null;
    const row = await bindings.DB.prepare("UPDATE qr_codes SET name = ?, destination_url = ?, active = ?, image_mode = ?, image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING id, slug, name, destination_url, active, image_mode, image_path, created_at, updated_at")
      .bind(qrCode.name.trim(), qrCode.destinationUrl.trim(), qrCode.active ? 1 : 0, imageMode, imagePath, id).first<QrCodeRow>();
    if (!row) return Response.json({ error: "QR code not found." }, { status: 404 });
    if (existing.image_path && !keepCustom) {
      const oldKey = existing.image_path.split("/").pop();
      if (oldKey?.startsWith("qr-")) await bindings.STUDENT_IMAGES.delete(oldKey).catch((error) => {
        console.error(JSON.stringify({ message: "Could not remove previous QR code image", error: error instanceof Error ? error.message : String(error), id }));
      });
    }
    return Response.json({
      id: row.id,
      slug: row.slug,
      name: row.name,
      destinationUrl: row.destination_url,
      redirectUrl: `${bindings.PUBLIC_QR_BASE_URL.replace(/\/$/, "")}/s/${row.slug}`,
      active: row.active === 1,
      imageMode: row.image_mode,
      imageUrl: row.image_mode === "logo" ? "/logo.svg" : row.image_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "Could not update QR code", error: error instanceof Error ? error.message : String(error), id }));
    return Response.json({ error: "Could not update QR code." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid QR code id." }, { status: 400 });

  try {
    const bindings = env as unknown as CloudflareEnv;
    const existing = await bindings.DB.prepare("SELECT image_path FROM qr_codes WHERE id = ?").bind(id).first<{ image_path: string | null }>();
    if (!existing) return Response.json({ error: "QR code not found." }, { status: 404 });
    const result = await bindings.DB.prepare("DELETE FROM qr_codes WHERE id = ?").bind(id).run();
    if (!result.success || result.meta.changes !== 1) return Response.json({ error: "Could not delete QR code." }, { status: 500 });

    const imageKey = existing.image_path?.split("/").pop();
    if (imageKey?.startsWith("qr-")) await bindings.STUDENT_IMAGES.delete(imageKey).catch((error) => {
      console.error(JSON.stringify({ message: "Could not remove deleted QR code image", error: error instanceof Error ? error.message : String(error), id }));
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(JSON.stringify({ message: "Could not delete QR code", error: error instanceof Error ? error.message : String(error), id }));
    return Response.json({ error: "Could not delete QR code." }, { status: 500 });
  }
}
