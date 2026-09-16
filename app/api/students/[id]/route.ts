import { env } from "../../../lib/storage";
import { schoolToday } from "../../../lib/calendar-dates";

type StudentRow = { id: number; first_name: string; last_name: string; email: string; phone: string; birth_date: string | null; facebook_url: string; instagram_url: string; picture: string | null; active: number };

function serialize(row: StudentRow) {
  return { id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, birthDate: row.birth_date, facebookUrl: row.facebook_url, instagramUrl: row.instagram_url, picture: row.picture, active: row.active === 1 };
}

function isPhoneConstraintError(error: unknown) {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed") && error.message.includes("phone");
}

function imageKey(picture: string | null) {
  const prefix = "/api/student-images/";
  if (!picture?.startsWith(prefix)) return null;
  try { return decodeURIComponent(picture.slice(prefix.length)); } catch { return null; }
}

function validBirthDate(value: unknown) {
  if (value === null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value > schoolToday()) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validSocialUrl(value: unknown) {
  if (typeof value !== "string") return false;
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch { return false; }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid student id." }, { status: 400 });
  try {
    const db = env.DB;
    const result = await db.prepare("SELECT id, first_name, last_name, email, phone, birth_date, facebook_url, instagram_url, picture, active FROM students WHERE id = ?").bind(id).first<StudentRow>();
    if (!result) return Response.json({ error: "Student not found." }, { status: 404 });
    return Response.json(serialize(result));
  } catch (error) {
    console.error("Could not load student", error);
    return Response.json({ error: "Could not load student. Check the Cloudflare Access service token." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid student id." }, { status: 400 });
  const input = await request.json().catch(() => null);
  if (!input || typeof input !== "object") return Response.json({ error: "A student object is required." }, { status: 400 });
  const student = input as Record<string, unknown>;
  if (typeof student.firstName !== "string" || !student.firstName.trim()) return Response.json({ error: "First name is required." }, { status: 400 });
  if (typeof student.lastName !== "string" || !student.lastName.trim()) return Response.json({ error: "Last name is required." }, { status: 400 });
  if (typeof student.email !== "string" || (student.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.email.trim()))) return Response.json({ error: "Enter a valid email or leave it empty." }, { status: 400 });
  if (typeof student.phone !== "string" || typeof student.active !== "boolean") return Response.json({ error: "Phone and active state are required." }, { status: 400 });
  if (!validBirthDate(student.birthDate)) return Response.json({ error: "Enter a valid birth date that is not in the future, or leave it empty." }, { status: 400 });
  if (!validSocialUrl(student.facebookUrl) || !validSocialUrl(student.instagramUrl)) return Response.json({ error: "Facebook and Instagram links must be HTTPS URLs or left empty." }, { status: 400 });
  if (student.picture !== null && typeof student.picture !== "string") return Response.json({ error: "Picture must be a URL or empty." }, { status: 400 });
  try {
    const db = env.DB;
    const existing = await db.prepare("SELECT picture FROM students WHERE id = ?").bind(id).first<{ picture: string | null }>();
    if (!existing) return Response.json({ error: "Student not found." }, { status: 404 });
    const phone = student.phone.trim();
    const facebookUrl = (student.facebookUrl as string).trim();
    const instagramUrl = (student.instagramUrl as string).trim();
    if (phone) {
      const duplicatePhone = await db.prepare("SELECT id FROM students WHERE id <> ? AND trim(phone) = ? LIMIT 1").bind(id, phone).first<{ id: number }>();
      if (duplicatePhone) return Response.json({ error: "A student with this phone number already exists." }, { status: 409 });
    }
    const [updated] = await db.batch<StudentRow>([db.prepare("UPDATE students SET first_name = ?, last_name = ?, email = ?, phone = ?, birth_date = ?, facebook_url = ?, instagram_url = ?, picture = ?, active = ? WHERE id = ? RETURNING id, first_name, last_name, email, phone, birth_date, facebook_url, instagram_url, picture, active").bind(
      student.firstName.trim(), student.lastName.trim(), student.email.trim(), phone, typeof student.birthDate === "string" && student.birthDate.trim() ? student.birthDate.trim() : null, facebookUrl, instagramUrl, typeof student.picture === "string" && student.picture.trim() ? student.picture.trim() : null, student.active ? 1 : 0, id,
    )]);
    const result = updated.results[0];
    if (!result) return Response.json({ error: "Student not found." }, { status: 404 });
    const previousImageKey = imageKey(existing.picture);
    if (previousImageKey && existing.picture !== result.picture) await env.STUDENT_IMAGES.delete(previousImageKey);
    return Response.json(serialize(result));
  } catch (error) {
    if (isPhoneConstraintError(error)) return Response.json({ error: "A student with this phone number already exists." }, { status: 409 });
    console.error("Could not update student", error);
    return Response.json({ error: "Could not update student. Check the Cloudflare Access service token." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid student id." }, { status: 400 });
  try {
    const db = env.DB;
    const student = await db.prepare("SELECT picture FROM students WHERE id = ?").bind(id).first<{ picture: string | null }>();
    if (!student) return Response.json({ error: "Student not found." }, { status: 404 });
    const [result] = await db.batch([db.prepare("DELETE FROM students WHERE id = ?").bind(id)]);
    if (result.meta.changes === 0) return Response.json({ error: "Student not found." }, { status: 404 });
    const studentImageKey = imageKey(student.picture);
    if (studentImageKey) await env.STUDENT_IMAGES.delete(studentImageKey);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (String(error).includes("FOREIGN KEY")) return Response.json({ error: "This student has linked records, such as tasks, attendance, or payments. Remove task relationships before deleting, or mark the student inactive to preserve their records." }, { status: 409 });
    console.error("Could not delete student", error);
    return Response.json({ error: "Could not delete student. Check the Cloudflare Access service token." }, { status: 500 });
  }
}
