import { env } from "../../lib/storage";

type StudentRow = { id: number; first_name: string; last_name: string; email: string; phone: string; picture: string | null; active: number; course_ids?: string };

function json(data: unknown, init?: ResponseInit) { return Response.json(data, init); }

function isPhoneConstraintError(error: unknown) {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed") && error.message.includes("phone");
}

function validateStudent(input: unknown) {
  if (!input || typeof input !== "object") return "A student object is required.";
  const student = input as Record<string, unknown>;
  if (typeof student.firstName !== "string" || !student.firstName.trim()) return "First name is required.";
  if (typeof student.lastName !== "string" || !student.lastName.trim()) return "Last name is required.";
  if (typeof student.email !== "string" || (student.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.email.trim()))) return "Enter a valid email or leave it empty.";
  if (typeof student.phone !== "string") return "Phone must be text.";
  if (student.phone.trim() && !/^\d{10,}$/.test(student.phone.trim())) return "Phone must contain only numbers and be at least 10 digits.";
  if (student.picture !== null && student.picture !== undefined && typeof student.picture !== "string") return "Picture must be a URL or empty.";
  if (student.active !== undefined && typeof student.active !== "boolean") return "Active must be true or false.";
  if (student.courseIds !== undefined && (!Array.isArray(student.courseIds) || !student.courseIds.every((id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0) || new Set(student.courseIds).size !== student.courseIds.length)) return "Choose valid courses without duplicates.";
  return null;
}

function serialize(row: StudentRow) {
  return { id: row.id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, picture: row.picture, active: row.active === 1, ...(row.course_ids !== undefined ? { courseIds: JSON.parse(row.course_ids) as number[] } : {}) };
}

export async function GET() {
  try {
    const db = env.DB;
    const result = await db.prepare("SELECT id, first_name, last_name, email, phone, picture, active, (SELECT json_group_array(course_id) FROM student_courses WHERE student_id = students.id) AS course_ids FROM students ORDER BY id ASC").all<StudentRow>();
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
    const db = env.DB;
    const email = (student.email as string).trim();
    const phone = (student.phone as string).trim();
    const duplicate = await db.prepare("SELECT email, phone FROM students WHERE (? <> '' AND lower(trim(email)) = lower(?)) OR (? <> '' AND trim(phone) = ?) LIMIT 1").bind(email, email, phone, phone).first<{ email: string; phone: string }>();
    if (duplicate) {
      const emailExists = Boolean(email) && duplicate.email.trim().toLocaleLowerCase() === email.toLocaleLowerCase();
      const phoneExists = Boolean(phone) && duplicate.phone.trim() === phone;
      const message = emailExists && phoneExists ? "A student with this email and phone number already exists." : emailExists ? "A student with this email already exists." : "A student with this phone number already exists.";
      return json({ error: message }, { status: 409 });
    }
    const insert = db.prepare("INSERT INTO students (first_name, last_name, email, phone, picture, active) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, first_name, last_name, email, phone, picture, active").bind(
      (student.firstName as string).trim(), (student.lastName as string).trim(), email, phone, typeof student.picture === "string" && student.picture.trim() ? student.picture.trim() : null, student.active === false ? 0 : 1,
    );
    // Keep creation and assignments atomic; materialize the student id before inserting course rows.
    const results = await db.batch<StudentRow>([
      insert,
      db.prepare("INSERT INTO student_courses (student_id, course_id) SELECT student.id, courses.value FROM (SELECT last_insert_rowid() AS id LIMIT 1) student CROSS JOIN json_each(?) courses").bind(JSON.stringify(student.courseIds ?? [])),
    ]);
    return json(serialize(results[0].results[0]), { status: 201 });
  } catch (error) {
    if (String(error).includes("FOREIGN KEY")) return json({ error: "A selected course no longer exists. Reload courses and try again." }, { status: 409 });
    if (isPhoneConstraintError(error)) return json({ error: "A student with this phone number already exists." }, { status: 409 });
    console.error("Could not create student", error);
    return json({ error: "Could not create student. Check the Cloudflare Access service token." }, { status: 500 });
  }
}
