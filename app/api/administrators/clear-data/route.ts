import { env } from "../../../lib/storage";

type ImageRow = { picture: string | null };

function imageKey(picture: string | null, prefix: "student-" | "admin-") {
  const imagePath = "/api/student-images/";
  if (!picture?.startsWith(imagePath)) return null;
  try {
    const key = decodeURIComponent(picture.slice(imagePath.length));
    return key.startsWith(prefix) ? key : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin) return new Response(null, { status: 403 });

  try {
    const db = env.DB;
    const [studentPictures] = await db.batch([
      db.prepare("SELECT picture FROM students"),
    ]);

    // D1 batch operations are transactional. Keep QR records, administrator accounts and
    // profiles, and their R2 images intact.
    await db.batch([
      db.prepare("DELETE FROM payment_preset_courses"),
      db.prepare("DELETE FROM payment_course_allowances"),
      db.prepare("DELETE FROM attendance"),
      db.prepare("DELETE FROM student_payments"),
      db.prepare("DELETE FROM student_courses"),
      db.prepare("UPDATE practice_attendance SET donation_amount_minor = NULL, donation_paid_on = NULL, donation_notes = '', donation_recorded_by = NULL, donation_recorded_at = NULL, donation_given_to_school = 0 WHERE donation_amount_minor IS NOT NULL"),
      db.prepare("DELETE FROM practice_attendance"),
      db.prepare("DELETE FROM practice_parties"),
      db.prepare("DELETE FROM classes"),
      db.prepare("DELETE FROM payment_presets"),
      db.prepare("DELETE FROM courses"),
      db.prepare("DELETE FROM students"),
    ]);

    const imageKeys = [
      ...(studentPictures.results as ImageRow[]).map((row) => imageKey(row.picture, "student-")),
    ].filter((key): key is string => key !== null);
    await Promise.all(imageKeys.map((key) => env.STUDENT_IMAGES.delete(key).catch((error) => {
      console.error("Could not remove cleared profile image", { key, error: error instanceof Error ? error.message : String(error) });
    })));

    return Response.json({ cleared: true });
  } catch (error) {
    console.error("Could not clear application data", error);
    return Response.json({ error: "Could not clear the application data. No QR codes were changed." }, { status: 500 });
  }
}
