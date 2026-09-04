import { env } from "cloudflare:workers";

type StudentRow = { id: number; first_name: string; last_name: string; email: string; phone: string; picture: string | null; active: number };

function json(data: unknown, init?: ResponseInit) { return Response.json(data, init); }

function validateStudent(input: unknown) {
  if (!input || typeof input !== "object") return "A student object is required.";
  const student = input as Record<string, unknown>;
  if (typeof student.firstName !== "string" || !student.firstName.trim()) return "First name is required.";
  if (typeof student.lastName !== "string" || !student.lastName.trim()) return "Last name is required.";
  if (typeof student.email !== "string" || !student.email.trim() || !student.email.includes("@")) return "A valid email is required.";
  if (typeof student.phone !== "string") return "Phone must be text.";
  if (student.phone.trim() && !/^\d{10,}$/.test(student.phone.trim())) return "Phone must contain only numbers and be at least 10 digits.";
  if (student.picture !== null && student.picture !== undefined && typeof student.picture !== "string") return "Picture must be a URL or empty.";
  if (student.active !== undefined && typeof student.active !== "boolean") return "Active must be true or false.";
  return null;
}

function serialize(row: StudentRow) {
  return { id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, picture: row.picture, active: row.active === 1 };
}

export async function GET() {
  try {
    const db = (env as unknown as CloudflareEnv).DB;
    const result = await db.prepare("SELECT id, first_name, last_name, email, phone, picture, active FROM students ORDER BY active DESC, last_name COLLATE NOCASE, first_name COLLATE NOCASE").all<StudentRow>();
    return json(result.results.map(serialize));
  } catch (error) {
    console.error("Could not load students", error);
    return json({ error: "Could not load students. Check the Cloudflare Access service token." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  const error = validateStudent(input);
  if (error) return json({ error }, { status: 400 });
  const student = input as Record<string, unknown>;
  try {
    const db = (env as unknown as CloudflareEnv).DB;
    const email = (student.email as string).trim();
    const phone = (student.phone as string).trim();
    const duplicate = await db.prepare("SELECT email, phone FROM students WHERE lower(trim(email)) = lower(?) OR (? <> '' AND trim(phone) = ?) LIMIT 1").bind(email, phone, phone).first<{ email: string; phone: string }>();
    if (duplicate) {
      const emailExists = duplicate.email.trim().toLocaleLowerCase() === email.toLocaleLowerCase();
      const phoneExists = Boolean(phone) && duplicate.phone.trim() === phone;
      const message = emailExists && phoneExists ? "A student with this email and phone number already exists." : emailExists ? "A student with this email already exists." : "A student with this phone number already exists.";
      return json({ error: message }, { status: 409 });
    }
    const result = await db.prepare("INSERT INTO students (first_name, last_name, email, phone, picture, active) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, first_name, last_name, email, phone, picture, active").bind(
      (student.firstName as string).trim(), (student.lastName as string).trim(), email, phone, typeof student.picture === "string" && student.picture.trim() ? student.picture.trim() : null, student.active === false ? 0 : 1,
    ).first<StudentRow>();
    return json(serialize(result as StudentRow), { status: 201 });
  } catch (error) {
    console.error("Could not create student", error);
    return json({ error: "Could not create student. Check the Cloudflare Access service token." }, { status: 500 });
  }
}
