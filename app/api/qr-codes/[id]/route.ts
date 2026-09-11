import { env } from "../../../lib/storage";

import { serialize, validate, type QrCodeRow } from "../../../lib/qr-codes";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid QR code id." }, { status: 400 });
  const input = await request.json().catch(() => null);
  const validationError = validate(input, true);
  if (validationError) return Response.json({ error: validationError }, { status: 400 });
  const qrCode = input as { name: string; destinationUrl: string; active: boolean; imageMode: "none" | "logo" | "custom"; moduleShape: "square" | "circle"; foregroundColor: string; eyeShape: "square" | "rounded" | "circle"; logoSize: number; logoShape: "square" | "rounded" | "circle"; advancedStyle: object };

  try {
    const bindings = env;
    const existing = await bindings.DB.prepare("SELECT image_mode, image_path FROM qr_codes WHERE id = ?").bind(id).first<{ image_mode: string; image_path: string | null }>();
    if (!existing) return Response.json({ error: "QR code not found." }, { status: 404 });
    const keepCustom = qrCode.imageMode === "custom" && existing.image_mode === "custom" && existing.image_path;
    const imageMode = keepCustom ? "custom" : qrCode.imageMode === "custom" ? "none" : qrCode.imageMode;
    const imagePath = keepCustom ? existing.image_path : null;
    const row = await bindings.DB.prepare("UPDATE qr_codes SET name = ?, destination_url = ?, active = ?, image_mode = ?, image_path = ?, module_shape = ?, foreground_color = ?, eye_shape = ?, eye_color = ?, logo_size = ?, logo_shape = ? WHERE id = ? RETURNING id, slug, name, destination_url, active, image_mode, image_path, module_shape, foreground_color, eye_shape, eye_color, logo_size, logo_shape")
      .bind(qrCode.name.trim(), qrCode.destinationUrl.trim(), qrCode.active ? 1 : 0, imageMode, imagePath, qrCode.moduleShape, qrCode.foregroundColor.toLowerCase(), qrCode.eyeShape, (qrCode.advancedStyle as { eyeColor: string }).eyeColor.toLowerCase(), qrCode.logoSize, qrCode.logoShape, id).first<QrCodeRow>();
    if (!row) return Response.json({ error: "QR code not found." }, { status: 404 });
    if (existing.image_path && !keepCustom) {
      const oldKey = existing.image_path.split("/").pop();
      if (oldKey?.startsWith("qr-")) await bindings.STUDENT_IMAGES.delete(oldKey).catch((error) => {
        console.error(JSON.stringify({ message: "Could not remove previous QR code image", error: error instanceof Error ? error.message : String(error), id }));
      });
    }
    return Response.json(serialize(row, bindings.PUBLIC_QR_BASE_URL));
  } catch (error) {
    console.error(JSON.stringify({ message: "Could not update QR code", error: error instanceof Error ? error.message : String(error), id }));
    return Response.json({ error: "Could not update QR code." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid QR code id." }, { status: 400 });

  try {
    const bindings = env;
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
