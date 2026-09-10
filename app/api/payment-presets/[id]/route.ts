import { env } from "cloudflare:workers";
import { parsePreset, presetQuery, serializePresets } from "../../../lib/payment-presets";

type Context = { params: Promise<{ id: string }> };
const headers = { "Cache-Control": "no-store" };
export async function PATCH(request: Request, context: Context) {
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "Invalid preset id." }, { status: 400, headers });
  const input = parsePreset(await request.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400, headers });
  try {
    const db = env.DB;
    if (!await db.prepare("SELECT id FROM payment_presets WHERE id = ?").bind(id).first()) return Response.json({ error: "Preset not found." }, { status: 404, headers });
    const results = await db.batch([
      db.prepare("UPDATE payment_presets SET name = ?, amount_minor = ? WHERE id = ?").bind(input.name, input.amountMinor, id),
      db.prepare("DELETE FROM payment_preset_courses WHERE preset_id = ?").bind(id),
      ...input.allocations.map((a) => db.prepare("INSERT INTO payment_preset_courses (preset_id, course_id, allowance) VALUES (?, ?, ?)").bind(id, a.courseId, a.allowance)),
      db.prepare(presetQuery + " WHERE p.id = ? ORDER BY a.course_id").bind(id),
    ]);
    return Response.json(serializePresets(results.at(-1)!.results as Parameters<typeof serializePresets>[0])[0], { headers });
  } catch (error) {
    if (String(error).includes("UNIQUE")) return Response.json({ error: "A preset with this name already exists." }, { status: 409, headers });
    if (String(error).includes("FOREIGN KEY")) return Response.json({ error: "The preset or a selected course no longer exists. Reload and try again." }, { status: 409, headers });
    console.error("Could not update payment preset", error); return Response.json({ error: "Could not save payment preset." }, { status: 500, headers });
  }
}
export async function DELETE(_request: Request, context: Context) {
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return Response.json({ error: "Invalid preset id." }, { status: 400, headers });
  try {
    const result = await env.DB.prepare("DELETE FROM payment_presets WHERE id = ?").bind(id).run();
    return result.meta.changes ? new Response(null, { status: 204, headers }) : Response.json({ error: "Preset not found." }, { status: 404, headers });
  } catch (error) { console.error("Could not delete payment preset", error); return Response.json({ error: "Could not delete payment preset." }, { status: 500, headers }); }
}
