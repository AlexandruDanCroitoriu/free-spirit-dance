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
    const result = await bindings.DB.prepare("SELECT id, slug, name, destination_url, active, image_mode, image_path, created_at, updated_at FROM qr_codes ORDER BY updated_at DESC, id DESC").all<QrCodeRow>();
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
  const qrCode = input as { name: string; destinationUrl: string; imageMode: "none" | "logo" | "custom" };
  const slug = crypto.randomUUID().replaceAll("-", "").slice(0, 16);

  try {
    const bindings = env as unknown as CloudflareEnv;
    const initialImageMode = qrCode.imageMode === "custom" ? "none" : qrCode.imageMode;
    const row = await bindings.DB.prepare("INSERT INTO qr_codes (slug, name, destination_url, image_mode) VALUES (?, ?, ?, ?) RETURNING id, slug, name, destination_url, active, image_mode, image_path, created_at, updated_at")
      .bind(slug, qrCode.name.trim(), qrCode.destinationUrl.trim(), initialImageMode).first<QrCodeRow>();
    if (!row) throw new Error("Insert did not return a QR code.");
    return Response.json(serialize(row, bindings.PUBLIC_QR_BASE_URL), { status: 201 });
  } catch (error) {
    console.error(JSON.stringify({ message: "Could not create QR code", error: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "Could not create QR code." }, { status: 500 });
  }
}
