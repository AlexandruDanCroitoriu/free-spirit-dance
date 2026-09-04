import { env } from "cloudflare:workers";

const maxImageBytes = 250_000;

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "An image file is required." }, { status: 400 });
  if (file.size > maxImageBytes) return Response.json({ error: "The compressed image is too large." }, { status: 400 });

  try {
    const key = `student-${crypto.randomUUID()}.jpg`;
    const bucket = (env as unknown as CloudflareEnv).STUDENT_IMAGES;
    await bucket.put(key, file.stream(), { httpMetadata: { contentType: "image/jpeg", cacheControl: "private, max-age=3600" } });
    return Response.json({ picture: `/api/student-images/${encodeURIComponent(key)}` }, { status: 201 });
  } catch (error) {
    console.error("Could not upload student image", error);
    return Response.json({ error: "Could not upload student image." }, { status: 500 });
  }
}