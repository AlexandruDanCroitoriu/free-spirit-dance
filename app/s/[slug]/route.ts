import { env } from "cloudflare:workers";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const slug = (await context.params).slug;
  if (!/^[a-f0-9]{16}$/.test(slug)) return new Response("QR code not found.", { status: 404, headers: { "Cache-Control": "no-store" } });

  try {
    const row = await (env as unknown as CloudflareEnv).DB.prepare("SELECT destination_url FROM qr_codes WHERE slug = ? AND active = 1").bind(slug).first<{ destination_url: string }>();
    if (!row) return new Response("QR code not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
    const destination = new URL(row.destination_url);
    if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) throw new Error("Stored destination URL is invalid.");
    return new Response(null, {
      status: 302,
      headers: {
        Location: destination.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "Could not resolve QR code", error: error instanceof Error ? error.message : String(error), slug }));
    return new Response("Could not resolve QR code.", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
