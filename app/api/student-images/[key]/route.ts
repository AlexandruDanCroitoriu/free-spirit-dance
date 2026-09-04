import { env } from "cloudflare:workers";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  const key = decodeURIComponent((await context.params).key);
  try {
    const object = await (env as unknown as CloudflareEnv).STUDENT_IMAGES.get(key);
    if (!object) return new Response("Not found", { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    return new Response(object.body, { headers });
  } catch (error) {
    console.error("Could not load student image", error);
    return new Response("Could not load image", { status: 500 });
  }
}