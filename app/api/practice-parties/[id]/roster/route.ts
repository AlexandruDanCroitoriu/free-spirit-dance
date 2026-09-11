import { env } from '../../../../lib/storage';
import { eventAccess, eventHandler, eventJson, EventError, positiveId } from '../../../../lib/practice-parties-server';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return eventHandler(async () => {
  await eventAccess(request);
  const id = positiveId(Number((await context.params).id)), url = new URL(request.url);
  if (!await env.DB.prepare('SELECT id FROM practice_parties WHERE id = ?').bind(id).first()) throw new EventError('Practice party not found.', 404);
  const search = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new EventError('Invalid page.');
  const attended = url.searchParams.get('attended') === '1';
  const where = `WHERE (? = '' OR instr(lower(s.first_name || ' ' || s.last_name || ' ' || COALESCE(s.email, '')), lower(?)) > 0) ${attended ? 'AND a.id IS NOT NULL' : ''}`;
  const rows = await env.DB.batch([
    env.DB.prepare(`SELECT s.id, s.first_name AS firstName, s.last_name AS lastName, s.email, s.picture, s.active, a.id AS attendanceId FROM students s LEFT JOIN practice_attendance a ON a.student_id = s.id AND a.practice_id = ? AND a.voided_at IS NULL ${where} ORDER BY s.active DESC, s.first_name COLLATE NOCASE, s.last_name COLLATE NOCASE, s.id LIMIT 100 OFFSET ?`).bind(id, search, search, (page - 1) * 100),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM students s LEFT JOIN practice_attendance a ON a.student_id = s.id AND a.practice_id = ? AND a.voided_at IS NULL ${where}`).bind(id, search, search),
  ]);
  return eventJson({ students: rows[0].results, count: (rows[1].results[0] as { count: number }).count });
}); }
