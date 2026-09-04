import { env } from "cloudflare:workers";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await context.params).key);
  if (!/^qr-\d+-[0-9a-f-]+\.(?:jpg|png|webp)$/.test(key)) return new Response("Not found", { status: 404 });
  try {
    const object = await (env as unknown as CloudflareEnv).STUDENT_IMAGES.get(key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(object.body, { headers });
  } catch (error) {
    console.error(JSON.stringify({ message: "Could not load QR code image", error: error instanceof Error ? error.message : String(error) }));
    return new Response("Could not load image", { status: 500 });
  }
}
