import { parseAmount } from "./student-activity";

export type PaymentPreset = { id: number; name: string; amountMinor: number; allocations: { courseId: number; courseName: string; allowance: number }[] };
export type PresetInput = { name: string; amountMinor: number; allocations: { courseId: number; allowance: number }[] };
export function parsePreset(value: unknown): PresetInput | string {
  if (!value || typeof value !== "object") return "Enter a payment preset.";
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 120) return "Enter a name of up to 120 characters.";
  const amountMinor = parseAmount(input.amount);
  if (amountMinor === null) return "Enter a positive RON amount with up to two decimal places.";
  if (!Array.isArray(input.allocations) || input.allocations.length < 1 || input.allocations.length > 100) return "Select between one and 100 courses.";
  const allocations: PresetInput["allocations"] = [];
  for (const value of input.allocations) {
    if (!value || typeof value !== "object") return "Enter valid course allowances.";
    const { courseId, allowance } = value as Record<string, unknown>;
    if (typeof courseId !== "number" || !Number.isSafeInteger(courseId) || courseId < 1 || typeof allowance !== "number" || !Number.isInteger(allowance) || allowance < 1 || allowance > 10000 || allocations.some((a) => a.courseId === courseId)) return "Select each course once and enter 1–10,000 classes per course.";
    allocations.push({ courseId, allowance });
  }
  return { name: input.name.trim(), amountMinor, allocations };
}
export const presetQuery = `SELECT p.id, p.name, p.amount_minor AS amountMinor, a.course_id AS courseId, c.name AS courseName, a.allowance
  FROM payment_presets p LEFT JOIN payment_preset_courses a ON a.preset_id = p.id LEFT JOIN courses c ON c.id = a.course_id`;
type PresetRow = { id: number; name: string; amountMinor: number; courseId: number | null; courseName: string | null; allowance: number | null };
export function serializePresets(rows: PresetRow[]): PaymentPreset[] {
  const items = new Map<number, PaymentPreset>();
  for (const row of rows) {
    if (!items.has(row.id)) items.set(row.id, { id: row.id, name: row.name, amountMinor: row.amountMinor, allocations: [] });
    if (row.courseId !== null) items.get(row.id)!.allocations.push({ courseId: row.courseId, courseName: row.courseName!, allowance: row.allowance! });
  }
  return [...items.values()];
}
export async function readPresets(db: D1Database) {
  const rows = await db.prepare(presetQuery + " ORDER BY p.name COLLATE NOCASE, p.id, a.course_id").all<PresetRow>();
  return serializePresets(rows.results);
}
export function presetDraft(preset: PaymentPreset) {
  return { amount: (preset.amountMinor / 100).toFixed(2), allocations: Object.fromEntries(preset.allocations.map((a) => [String(a.courseId), String(a.allowance)])) };
}
