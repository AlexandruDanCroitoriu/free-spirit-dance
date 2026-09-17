import { env } from './storage';
import { eventAccess, EventError, eventJson } from './free-events-server';
import { positiveId } from './practice-parties-server';
import { parseAmount, formatMoney } from './student-activity';

type Meeting = { id: number; revision: number; cancelled: number; accepts_donations: number };
type Attendance = { id: number; student_id: number; name: string; donation_amount_minor: number | null; donation_received_method: string; donation_given_to_school: number };
async function meeting(eventId: number, id: number) {
  const result = await env.DB.prepare('SELECT id, revision, cancelled, accepts_donations FROM free_event_meetings WHERE event_id = ? AND id = ?').bind(eventId, id).first<Meeting>();
  if (!result) throw new EventError('Meeting not found.', 404);
  return result;
}

export async function meetingRoster(request: Request, eventId: number, id: number) {
  const { email } = await eventAccess(request);
  const current = await meeting(eventId, id), url = new URL(request.url);
  const search = (url.searchParams.get('q') ?? '').trim().slice(0, 120), page = Number(url.searchParams.get('page') ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new EventError('Invalid page.');
  const where = `WHERE (? = '' OR instr(lower(s.first_name || ' ' || s.last_name || ' ' || COALESCE(s.email, '') || ' ' || s.phone), lower(?)) > 0)`;
  const rows = await env.DB.batch([
    env.DB.prepare(`SELECT s.id, s.first_name AS firstName, s.last_name AS lastName, s.email, s.picture, s.active, a.id AS attendanceId, a.donation_amount_minor AS donationAmountMinor, a.donation_received_method AS donationReceivedMethod FROM students s LEFT JOIN free_event_attendance a ON a.student_id = s.id AND a.meeting_id = ? ${where} ORDER BY a.id IS NOT NULL DESC, s.active DESC, s.first_name COLLATE NOCASE, s.last_name COLLATE NOCASE, s.id LIMIT 100 OFFSET ?`).bind(id, search, search, (page - 1) * 100),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM students s ${where}`).bind(search, search),
    env.DB.prepare('SELECT method FROM administrator_payment_methods WHERE email = ? ORDER BY method COLLATE NOCASE').bind(email),
  ]);
  return eventJson({ students: rows[0].results, count: (rows[1].results[0] as { count: number }).count, paymentMethods: rows[2].results, revision: current.revision });
}

export async function saveMeetingAttendance(request: Request, eventId: number, id: number) {
  const { email } = await eventAccess(request);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new EventError('Cross-origin writes are not allowed.', 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new EventError('Send JSON attendance details.', 415);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || body.action !== 'attendance_batch' || typeof body.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestKey)) throw new EventError('Invalid attendance request.');
  const current = await meeting(eventId, id), requestHash = JSON.stringify({ body, email, eventId, id });
  const previous = await env.DB.prepare("SELECT after_json FROM free_meeting_change_log WHERE meeting_id = ? AND json_extract(after_json, '$.requestKey') = ?").bind(id, body.requestKey).first<{ after_json: string }>();
  if (previous) {
    if (JSON.parse(previous.after_json).requestHash !== requestHash) throw new EventError('Save key already used for different details.', 409);
    return eventJson({ id });
  }
  if (body.revision !== current.revision) throw new EventError('This meeting changed. Reload before saving attendance.', 409);
  if (current.cancelled) throw new EventError('Cancelled meetings cannot receive attendance.', 409);
  if (!Array.isArray(body.addStudentIds) || !Array.isArray(body.removeAttendanceIds) || !Array.isArray(body.donations) || body.addStudentIds.length + body.removeAttendanceIds.length + body.donations.length < 1 || body.addStudentIds.length + body.removeAttendanceIds.length + body.donations.length > 300) throw new EventError('Select between 1 and 300 changes.');
  const add = body.addStudentIds.map(positiveId), remove = body.removeAttendanceIds.map(positiveId);
  if (new Set(add).size !== add.length || new Set(remove).size !== remove.length) throw new EventError('Choose each student once.');
  const records = await env.DB.prepare("SELECT a.*, trim(s.first_name || ' ' || s.last_name) AS name FROM free_event_attendance a JOIN students s ON s.id = a.student_id WHERE a.meeting_id = ?").bind(id).all<Attendance>();
  const existing = new Map(records.results.map(row => [row.student_id, row]));
  const removed = remove.map(attendanceId => {
    const row = records.results.find(item => item.id === attendanceId);
    if (!row) throw new EventError('Attendance no longer exists in this meeting.', 409);
    if (row.donation_given_to_school) throw new EventError('Undo the school transfer before removing this donation or attendance.', 409);
    return row;
  });
  const added = new Map<number, string>();
  for (const studentId of add) {
    if (existing.has(studentId)) throw new EventError('Student already attends this meeting.', 409);
    const student = await env.DB.prepare("SELECT trim(first_name || ' ' || last_name) AS name FROM students WHERE id = ?").bind(studentId).first<{ name: string }>();
    if (!student) throw new EventError('Student no longer exists.', 409);
    added.set(studentId, student.name);
  }
  const donations = new Map<number, { amount: number | null; method: string }>();
  for (const raw of body.donations) {
    const value = raw as Record<string, unknown> | null, studentId = positiveId(value?.studentId);
    if (donations.has(studentId) || (!added.has(studentId) && !existing.has(studentId)) || removed.some(row => row.student_id === studentId)) throw new EventError('Donations require an attending student.');
    if (existing.get(studentId)?.donation_given_to_school) throw new EventError('Undo the school transfer before changing this donation.', 409);
    const amount = parseAmount(value?.amount);
    const blank = typeof value?.amount === 'string' && value.amount.trim() === '';
    if (amount === null && !blank) throw new EventError('Enter a positive donation amount, or leave it blank.');
    const method = amount === null ? '' : typeof value?.receivedMethod === 'string' ? value.receivedMethod.trim() : '';
    if (amount !== null && (!method || !await env.DB.prepare('SELECT method FROM administrator_payment_methods WHERE email = ? AND method = ? COLLATE NOCASE').bind(email, method).first())) throw new EventError('Choose one of your payment methods.');
    donations.set(studentId, { amount, method });
  }
  const changedIds = new Set([...add, ...removed.map(row => row.student_id), ...donations.keys()]);
  const describe = (studentId: number, after: boolean) => {
    const row = existing.get(studentId), name = row?.name ?? added.get(studentId) ?? 'Student';
    const attends = after ? !removed.some(item => item.student_id === studentId) : Boolean(row);
    const donation = after ? donations.get(studentId) : undefined;
    const amount = donation ? donation.amount : row?.donation_amount_minor;
    return `${name}: ${attends ? 'Attended' : 'Not attending'}${attends && amount ? ` · ${formatMoney(amount)} · ${donation?.method ?? row?.donation_received_method}` : ''}`;
  };
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email),
    // The NOT NULL constraint deliberately aborts the entire batch on a stale revision.
    env.DB.prepare('UPDATE free_event_meetings SET revision = CASE WHEN revision = ? THEN revision + 1 ELSE NULL END, updated_at = ? WHERE id = ? AND event_id = ?').bind(current.revision, now, id, eventId),
  ];
  for (const studentId of add) statements.push(env.DB.prepare('INSERT INTO free_event_attendance (meeting_id, student_id, recorded_by, recorded_at) VALUES (?, ?, ?, ?)').bind(id, studentId, email, now));
  for (const attendanceId of remove) {
    // A transfer may have been recorded since validation; abort rather than erase it.
    statements.push(env.DB.prepare('UPDATE free_event_attendance SET donation_given_to_school = CASE WHEN donation_given_to_school = 0 THEN 0 ELSE NULL END WHERE id = ? AND meeting_id = ?').bind(attendanceId, id));
    statements.push(env.DB.prepare('DELETE FROM free_event_attendance WHERE id = ? AND meeting_id = ?').bind(attendanceId, id));
  }
  for (const [studentId, donation] of donations) statements.push(env.DB.prepare('UPDATE free_event_attendance SET donation_amount_minor = ?, donation_received_method = ?, donation_given_to_school = CASE WHEN donation_given_to_school = 0 THEN 0 ELSE NULL END, recorded_by = ?, recorded_at = ? WHERE meeting_id = ? AND student_id = ?').bind(donation.amount, donation.method, email, now, id, studentId));
  statements.push(env.DB.prepare('INSERT INTO free_meeting_change_log (meeting_id, administrator_email, action, before_json, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, email, 'attendance_updated', JSON.stringify({ attendance: [...changedIds].map(studentId => describe(studentId, false)).join('\n') }), JSON.stringify({ attendance: [...changedIds].map(studentId => describe(studentId, true)).join('\n'), requestKey: body.requestKey, requestHash }), now));
  await env.DB.batch(statements);
  return eventJson({ id });
}
