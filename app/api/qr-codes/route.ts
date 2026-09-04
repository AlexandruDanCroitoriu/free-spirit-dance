import { env } from "cloudflare:workers";

type QrCodeRow = {
  id: number;
  slug: string;
  name: string;
  destination_url: string;
  active: number;
  image_mode: "none" | "logo" | "custom";
  image_path: string | null;
  module_shape: "square" | "circle";
  foreground_color: string;
  eye_shape: "square" | "rounded" | "circle";
  background_color: string;
  logo_size: number;
  logo_shape: "square" | "rounded" | "circle";
  advanced_style: string;
  created_at: string;
  updated_at: string;
};

function serialize(row: QrCodeRow, baseUrl: string) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    destinationUrl: row.destination_url,
    redirectUrl: `${baseUrl.replace(/\/$/, "")}/s/${row.slug}`,
    active: row.active === 1,
    imageMode: row.image_mode,
    imageUrl: row.image_mode === "logo" ? "/logo.svg" : row.image_path,
    moduleShape: row.module_shape,
    foregroundColor: row.foreground_color,
    eyeShape: row.eye_shape,
    backgroundColor: row.background_color,
    logoSize: row.logo_size,
    logoShape: row.logo_shape,
    advancedStyle: JSON.parse(row.advanced_style || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validate(input: unknown) {
  if (!input || typeof input !== "object") return "QR code details are required.";
  const qrCode = input as Record<string, unknown>;
  if (typeof qrCode.name !== "string" || !qrCode.name.trim()) return "Name is required.";
  if (qrCode.name.trim().length > 100) return "Name must be 100 characters or fewer.";
  if (typeof qrCode.destinationUrl !== "string" || !qrCode.destinationUrl.trim()) return "Destination URL is required.";
  if (qrCode.destinationUrl.trim().length > 2048) return "Destination URL is too long.";
  if (!["none", "logo", "custom"].includes(String(qrCode.imageMode))) return "Choose a valid QR code image.";
  if (!["square", "circle"].includes(String(qrCode.moduleShape))) return "Choose a valid QR code shape.";
  if (typeof qrCode.foregroundColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(qrCode.foregroundColor)) return "Enter a valid 6-digit hex color.";
  if (!["square", "rounded", "circle"].includes(String(qrCode.eyeShape))) return "Choose a valid corner style.";
  if (typeof qrCode.backgroundColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(qrCode.backgroundColor)) return "Enter a valid background color.";
  if (!Number.isInteger(qrCode.logoSize) || Number(qrCode.logoSize) < 15 || Number(qrCode.logoSize) > 30) return "Logo size must be between 15 and 30 percent.";
  if (!["square", "rounded", "circle"].includes(String(qrCode.logoShape))) return "Choose a valid logo shape.";
  if (!qrCode.advancedStyle || typeof qrCode.advancedStyle !== "object") return "Choose valid advanced styling.";
  try {
    const destination = new URL(qrCode.destinationUrl.trim());
    if (!['http:', 'https:'].includes(destination.protocol)) return "Destination URL must use HTTP or HTTPS.";
    if (destination.username || destination.password) return "Destination URL cannot contain credentials.";
  } catch { return "Enter a valid destination URL."; }
  return null;
}

export async function GET() {
  try {
    const bindings = env as unknown as CloudflareEnv;
    const result = await bindings.DB.prepare("SELECT id, slug, name, destination_url, active, image_mode, image_path, module_shape, foreground_color, eye_shape, background_color, logo_size, logo_shape, advanced_style, created_at, updated_at FROM qr_codes ORDER BY updated_at DESC, id DESC").all<QrCodeRow>();
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
  const qrCode = input as { name: string; destinationUrl: string; imageMode: "none" | "logo" | "custom"; moduleShape: "square" | "circle"; foregroundColor: string; eyeShape: "square" | "rounded" | "circle"; backgroundColor: string; logoSize: number; logoShape: "square" | "rounded" | "circle"; advancedStyle: object };
  const slug = crypto.randomUUID().replaceAll("-", "").slice(0, 16);

  try {
    const bindings = env as unknown as CloudflareEnv;
    const initialImageMode = qrCode.imageMode === "custom" ? "none" : qrCode.imageMode;
    const row = await bindings.DB.prepare("INSERT INTO qr_codes (slug, name, destination_url, image_mode, module_shape, foreground_color, eye_shape, background_color, logo_size, logo_shape, advanced_style) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, slug, name, destination_url, active, image_mode, image_path, module_shape, foreground_color, eye_shape, background_color, logo_size, logo_shape, advanced_style, created_at, updated_at")
      .bind(slug, qrCode.name.trim(), qrCode.destinationUrl.trim(), initialImageMode, qrCode.moduleShape, qrCode.foregroundColor.toLowerCase(), qrCode.eyeShape, qrCode.backgroundColor.toLowerCase(), qrCode.logoSize, qrCode.logoShape, JSON.stringify(qrCode.advancedStyle)).first<QrCodeRow>();
    if (!row) throw new Error("Insert did not return a QR code.");
    return Response.json(serialize(row, bindings.PUBLIC_QR_BASE_URL), { status: 201 });
  } catch (error) {
    console.error(JSON.stringify({ message: "Could not create QR code", error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "Could not create QR code." }, { status: 500 });
  }
}
