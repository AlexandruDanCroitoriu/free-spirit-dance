export type QrCodeRow = {
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
  logo_size: number;
  logo_shape: "square" | "rounded" | "circle";
  eye_color: string;
};

export function serialize(row: QrCodeRow, baseUrl: string) {
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
    logoSize: row.logo_size,
    logoShape: row.logo_shape,
    advancedStyle: { eyeColor: row.eye_color },

  };
}

export function validate(input: unknown, requireActive = false) {
  if (!input || typeof input !== "object") return "QR code details are required.";
  const qrCode = input as Record<string, unknown>;
  if (typeof qrCode.name !== "string" || !qrCode.name.trim()) return "Name is required.";
  if (qrCode.name.trim().length > 100) return "Name must be 100 characters or fewer.";
  if (typeof qrCode.destinationUrl !== "string" || !qrCode.destinationUrl.trim()) return "Destination URL is required.";
  if (qrCode.destinationUrl.trim().length > 2048) return "Destination URL is too long.";
  if (requireActive && typeof qrCode.active !== "boolean") return "Active state is required.";
  if (!["none", "logo", "custom"].includes(String(qrCode.imageMode))) return "Choose a valid QR code image.";
  if (!["square", "circle"].includes(String(qrCode.moduleShape))) return "Choose a valid QR code shape.";
  if (typeof qrCode.foregroundColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(qrCode.foregroundColor)) return "Enter a valid 6-digit hex color.";
  if (!["square", "rounded", "circle"].includes(String(qrCode.eyeShape))) return "Choose a valid corner style.";
  if (!Number.isInteger(qrCode.logoSize) || Number(qrCode.logoSize) < 15 || Number(qrCode.logoSize) > 30) return "Logo size must be between 15 and 30 percent.";
  if (!["square", "rounded", "circle"].includes(String(qrCode.logoShape))) return "Choose a valid logo shape.";
  if (!qrCode.advancedStyle || typeof qrCode.advancedStyle !== "object" || typeof (qrCode.advancedStyle as Record<string, unknown>).eyeColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(String((qrCode.advancedStyle as Record<string, unknown>).eyeColor))) return "Enter a valid eye color.";
  try {
    const destination = new URL(qrCode.destinationUrl.trim());
    if (!['http:', 'https:'].includes(destination.protocol)) return "Destination URL must use HTTP or HTTPS.";
    if (destination.username || destination.password) return "Destination URL cannot contain credentials.";
  } catch { return "Enter a valid destination URL."; }
  return null;
}

