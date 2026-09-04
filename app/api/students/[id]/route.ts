import { env } from "cloudflare:workers";

type StudentRow = { id: number; first_name: string; last_name: string; email: string; phone: string; picture: string | null; active: number };

function serialize(row: StudentRow) {
  return { id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, picture: row.picture, active: row.active === 1 };
}

function isPhoneConstraintError(error: unknown) {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed") && error.message.includes("phone");
}

function imageKey(picture: string | null) {
  const prefix = "/api/student-images/";
  if (!picture?.startsWith(prefix)) return null;
  try { return decodeURIComponent(picture.slice(prefix.length)); } catch { return null; }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid student id." }, { status: 400 });
  try {
    const db = (env as unknown as CloudflareEnv).DB;
    const result = await db.prepare("SELECT id, first_name, last_name, email, phone, picture, active FROM students WHERE id = ?").bind(id).first<StudentRow>();
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
  if (typeof student.email !== "string" || !student.email.trim() || !student.email.includes("@")) return Response.json({ error: "A valid email is required." }, { status: 400 });
  if (typeof student.phone !== "string" || typeof student.active !== "boolean") return Response.json({ error: "Phone and active state are required." }, { status: 400 });
  if (student.phone.trim() && !/^\d{10,}$/.test(student.phone.trim())) return Response.json({ error: "Phone must contain only numbers and be at least 10 digits." }, { status: 400 });
  if (student.picture !== null && typeof student.picture !== "string") return Response.json({ error: "Picture must be a URL or empty." }, { status: 400 });
  try {
    const db = (env as unknown as CloudflareEnv).DB;
    const existing = await db.prepare("SELECT picture FROM students WHERE id = ?").bind(id).first<{ picture: string | null }>();
    if (!existing) return Response.json({ error: "Student not found." }, { status: 404 });
    const phone = student.phone.trim();
    if (phone) {
      const duplicatePhone = await db.prepare("SELECT id FROM students WHERE id <> ? AND trim(phone) = ? LIMIT 1").bind(id, phone).first<{ id: number }>();
      if (duplicatePhone) return Response.json({ error: "A student with this phone number already exists." }, { status: 409 });
    }
    const result = await db.prepare("UPDATE students SET first_name = ?, last_name = ?, email = ?, phone = ?, picture = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING id, first_name, last_name, email, phone, picture, active").bind(
      student.firstName.trim(), student.lastName.trim(), student.email.trim(), phone, typeof student.picture === "string" && student.picture.trim() ? student.picture.trim() : null, student.active ? 1 : 0, id,
    ).first<StudentRow>();
    if (!result) return Response.json({ error: "Student not found." }, { status: 404 });
    const previousImageKey = imageKey(existing.picture);
    if (previousImageKey && existing.picture !== result.picture) await (env as unknown as CloudflareEnv).STUDENT_IMAGES.delete(previousImageKey);
    return Response.json({ id: result.id, firstName: result.first_name, lastName: result.last_name, email: result.email, phone: result.phone, picture: result.picture, active: result.active === 1 });
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
    const db = (env as unknown as CloudflareEnv).DB;
    const student = await db.prepare("SELECT picture FROM students WHERE id = ?").bind(id).first<{ picture: string | null }>();
    if (!student) return Response.json({ error: "Student not found." }, { status: 404 });
    const result = await db.prepare("DELETE FROM students WHERE id = ?").bind(id).run();
    if (result.meta.changes === 0) return Response.json({ error: "Student not found." }, { status: 404 });
    const studentImageKey = imageKey(student.picture);
    if (studentImageKey) await (env as unknown as CloudflareEnv).STUDENT_IMAGES.delete(studentImageKey);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Could not delete student", error);
    return Response.json({ error: "Could not delete student. Check the Cloudflare Access service token." }, { status: 500 });
  }
}
