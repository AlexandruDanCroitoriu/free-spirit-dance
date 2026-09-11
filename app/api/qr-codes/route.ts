import { env } from "../../lib/storage";

import { serialize, validate, type QrCodeRow } from "../../lib/qr-codes";

export async function GET() {
  try {
    const bindings = env;
    const result = await bindings.DB.prepare("SELECT id, slug, name, destination_url, active, image_mode, image_path, module_shape, foreground_color, eye_shape, eye_color, logo_size, logo_shape FROM qr_codes ORDER BY id DESC").all<QrCodeRow>();
    return Response.json(result.results.map((row) => serialize(row, bindings.PUBLIC_QR_BASE_URL)));
  } catch (error) {
    console.error(JSON.stringify({ message: "Could not load QR codes", error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "Could not load QR codes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const validationError = validate(input);
  if (validationError) return Response.json({ error: validationError }, { status: 400 });
  const qrCode = input as { name: string; destinationUrl: string; imageMode: "none" | "logo" | "custom"; moduleShape: "square" | "circle"; foregroundColor: string; eyeShape: "square" | "rounded" | "circle"; logoSize: number; logoShape: "square" | "rounded" | "circle"; advancedStyle: object };
  const slug = crypto.randomUUID().replaceAll("-", "").slice(0, 16);

  try {
    const bindings = env;
    const initialImageMode = qrCode.imageMode === "custom" ? "none" : qrCode.imageMode;
    const row = await bindings.DB.prepare("INSERT INTO qr_codes (slug, name, destination_url, image_mode, module_shape, foreground_color, eye_shape, eye_color, logo_size, logo_shape) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, slug, name, destination_url, active, image_mode, image_path, module_shape, foreground_color, eye_shape, eye_color, logo_size, logo_shape")
      .bind(slug, qrCode.name.trim(), qrCode.destinationUrl.trim(), initialImageMode, qrCode.moduleShape, qrCode.foregroundColor.toLowerCase(), qrCode.eyeShape, (qrCode.advancedStyle as { eyeColor: string }).eyeColor.toLowerCase(), qrCode.logoSize, qrCode.logoShape).first<QrCodeRow>();
    if (!row) throw new Error("Insert did not return a QR code.");
    return Response.json(serialize(row, bindings.PUBLIC_QR_BASE_URL), { status: 201 });
  } catch (error) {
    console.error(JSON.stringify({ message: "Could not create QR code", error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "Could not create QR code." }, { status: 500 });
  }
}
