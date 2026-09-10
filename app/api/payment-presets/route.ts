import { env } from "cloudflare:workers";
import { parsePreset, presetQuery, readPresets, serializePresets } from "../../lib/payment-presets";

const headers = { "Cache-Control": "no-store" };
export async function GET() {
  try {
    const db = env.DB;
    const [presets, courses] = await Promise.all([readPresets(db), db.prepare("SELECT id, name FROM courses ORDER BY name COLLATE NOCASE, id").all()]);
    return Response.json({ presets, courses: courses.results }, { headers });
  } catch (error) { console.error("Could not load payment presets", error); return Response.json({ error: "Could not load payment presets." }, { status: 500, headers }); }
}
export async function POST(request: Request) {
  const input = parsePreset(await request.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400, headers });
  try {
    const db = env.DB;
    const results = await db.batch([
      db.prepare("INSERT INTO payment_presets (name, amount_minor) VALUES (?, ?)").bind(input.name, input.amountMinor),
      ...input.allocations.map((a) => db.prepare("INSERT INTO payment_preset_courses (preset_id, course_id, allowance) VALUES ((SELECT seq FROM sqlite_sequence WHERE name = 'payment_presets'), ?, ?)").bind(a.courseId, a.allowance)),
      db.prepare(presetQuery + " WHERE p.id = (SELECT seq FROM sqlite_sequence WHERE name = 'payment_presets') ORDER BY a.course_id"),
    ]);
    return Response.json(serializePresets(results.at(-1)!.results as Parameters<typeof serializePresets>[0])[0], { status: 201, headers });
  } catch (error) {
    if (String(error).includes("UNIQUE")) return Response.json({ error: "A preset with this name already exists." }, { status: 409, headers });
    if (String(error).includes("FOREIGN KEY")) return Response.json({ error: "A selected course no longer exists. Reload and try again." }, { status: 409, headers });
    console.error("Could not create payment preset", error); return Response.json({ error: "Could not save payment preset." }, { status: 500, headers });
  }
}
