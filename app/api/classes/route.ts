import { env } from "../../lib/storage";
import { parseClass } from "../../lib/class-attendance";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const email = request.headers.get("cf-access-authenticated-user-email")?.trim() || (["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname) ? "administrator@local" : null);
  if (!email) return json({ error: "Sign in to add a class." }, 401);
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const slot = input && parseClass(input);
  if (!slot || typeof input?.endTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.endTime) || input.endTime <= slot.startTime) return json({ error: "Choose a valid course, date, and end time after the start time." }, 400);
  const rent = input.rentCostMinor;
  if (typeof rent !== "number" || !Number.isSafeInteger(rent) || rent < 0 || rent > 99_999_999) return json({ error: "Enter a rent cost from 0 to 999,999.99 RON." }, 400);
  try {
    const course = await env.DB.prepare("SELECT id FROM courses WHERE id = ?").bind(slot.courseId).first();
    if (!course) return json({ error: "This course no longer exists. Reload the calendar." }, 404);
    await env.DB.prepare("INSERT INTO classes (course_id, class_date, start_time, end_time, rent_cost_minor) VALUES (?, ?, ?, ?, ?) ON CONFLICT (course_id, class_date, start_time) DO NOTHING").bind(slot.courseId, slot.classDate, slot.startTime, input.endTime, rent).run();
    const saved = await env.DB.prepare("SELECT id, end_time AS endTime, rent_cost_minor AS rentCostMinor, cancelled FROM classes WHERE course_id = ? AND class_date = ? AND start_time = ?").bind(slot.courseId, slot.classDate, slot.startTime).first<{ id: number; endTime: string; rentCostMinor: number; cancelled: number }>();
    if (!saved || saved.cancelled || saved.endTime !== input.endTime || saved.rentCostMinor !== rent) return json({ error: "A class already exists at this time. Reload the calendar to view it." }, 409);
    return json({ id: saved.id });
  } catch (error) {
    console.error("Could not add calendar class", error);
    return json({ error: "Could not confirm the class was saved. Retry safely." }, 500);
  }
}
