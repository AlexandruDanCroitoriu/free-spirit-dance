import { env } from './storage';
import { parseSession } from './practice-parties';
import { parseAmount, validPaymentDate } from './student-activity';

export const eventJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export class EventError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const positiveId = (value: unknown): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new EventError('Invalid record.'); return value; };
export const cleanText = (value: unknown, max: number, required = false) => { if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new EventError(`Enter ${required ? 'a value of ' : ''}up to ${max} characters.`); return value.trim(); };
export async function eventAccess(request: Request) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  const email = request.headers.get('cf-access-authenticated-user-email')?.trim().toLowerCase() || (local ? 'administrator@local' : '');
  if (!email) throw new EventError('Sign in to manage practice parties.', 401);
  if (local || email === 'croitoriu.alexandru.code@gmail.com') return { email, events: true, roster: true, finance: true, dashboard: true };
  const row = await env.DB.prepare('SELECT can_practice_parties, can_students, can_dashboard FROM administrator_permissions WHERE email = ?').bind(email).first<{ can_practice_parties: number; can_students: number; can_dashboard: number }>();
  return { email, events: row?.can_practice_parties === 1, roster: row?.can_practice_parties === 1 && row?.can_students === 1, finance: row?.can_practice_parties === 1 && row?.can_students === 1, dashboard: row?.can_dashboard === 1 };
}
export async function eventHandler(work: () => Promise<Response>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof EventError) return eventJson({ error: error.message }, error.status);
    if (/no such table: (?:practice_|school_payment_records)|no such column: .*practice/i.test(String(error))) return eventJson({ error: 'Practice Parties are not set up in this database. Apply migration 0037 and restart local development.' }, 503);
    if (/UNIQUE|CHECK|FOREIGN KEY|NOT NULL/.test(String(error))) return eventJson({ error: 'The record changed or was already saved. Reload and retry; no partial changes were saved.' }, 409);
    console.error('Practice-party operation failed', error instanceof Error ? error.name : 'Unknown error');
    return eventJson({ error: 'Could not confirm the operation. Retry the same save to avoid duplicates.' }, 500);
  }
}
export const sessionColumns = `s.id, s.starts_at AS startsAt, s.starts_utc AS startsUtc, s.duration_minutes AS durationMinutes, s.cancelled, s.revision,
  (SELECT COUNT(*) FROM practice_attendance a WHERE a.practice_id = s.id AND a.voided_at IS NULL) AS attendanceCount`;
export async function readEvent(id: number) {
  const party = await env.DB.prepare(`SELECT ${sessionColumns} FROM practice_parties s WHERE s.id = ?`).bind(id).first<import('./practice-parties').PracticeSession>();
  if (!party) throw new EventError('Practice party not found.', 404);
  return party;
}
export async function eventDetail(id: number, access: Awaited<ReturnType<typeof eventAccess>>) {
  const party = await readEvent(id);
  const changes = await env.DB.prepare('SELECT id, reason, before_json AS beforeJson, after_json AS afterJson, recorded_by AS recordedBy, recorded_at AS recordedAt FROM practice_changes WHERE practice_id = ? ORDER BY id DESC').bind(id).all();
  const payments = access.finance ? await env.DB.prepare(`SELECT p.id, p.student_id AS studentId, trim(s.first_name || ' ' || s.last_name) AS studentName, p.practice_id AS practiceId, p.amount_minor AS amountMinor, p.paid_on AS paidOn, p.notes, p.recorded_by AS recordedBy, p.given_to_school AS givenToSchool FROM practice_donations p JOIN students s ON s.id = p.student_id WHERE p.practice_id = ? ORDER BY p.paid_on DESC, p.id DESC`).bind(id).all<import('./practice-parties').EventPayment>() : { results: [] };
  const totals = payments.results.reduce((t, p) => ({ receivedMinor: t.receivedMinor + p.amountMinor, givenMinor: t.givenMinor + (p.givenToSchool ? p.amountMinor : 0), pendingMinor: t.pendingMinor + (p.givenToSchool ? 0 : p.amountMinor) }), { receivedMinor: 0, givenMinor: 0, pendingMinor: 0 });
  return { party, changes: changes.results, payments: payments.results, totals, permissions: access };
}

export async function mutateEvent(request: Request, id?: number) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new EventError('Cross-origin writes are not allowed.', 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new EventError('Send JSON practice-party details.', 415);
  const access = await eventAccess(request);
  if (!access.events) throw new EventError('Practice Parties permission is required.', 403);
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!input || typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey)) throw new EventError('Invalid save request.');
  const action = input.action;
  if (typeof action !== 'string') throw new EventError('Choose a practice-party action.');
  if (['attendance', 'attendance_batch', 'void_attendance'].includes(action) && !access.roster) throw new EventError('Practice Parties and Students permissions are required.', 403);
  if (['donation', 'edit_donation', 'delete_donation', 'handover'].includes(action) || (action === 'attendance' && input.amount) || (action === 'attendance_batch' && Array.isArray(input.donations) && input.donations.length)) {
    if (!access.finance) throw new EventError('Practice Parties and Students permissions are required.', 403);
  }
  const db = env.DB, email = access.email, now = new Date().toISOString(), key = input.requestKey;
  const payload = JSON.stringify({ practiceId: id ?? null, input });
  const existing = await db.prepare('SELECT practice_id, payload, recorded_by FROM practice_requests WHERE request_key = ?').bind(key).first<{ practice_id: number; payload: string; recorded_by: string }>();
  if (existing) {
    if (existing.payload !== payload || existing.recorded_by !== email) throw new EventError('This save key was already used for different details.', 409);
    return eventJson({ id: existing.practice_id });
  }
  const statements: D1PreparedStatement[] = [db.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email)];
  if (id === undefined) {
    if (action !== 'create') throw new EventError('Invalid practice-party action.');
    let session; try { session = parseSession(input.session); } catch (e) { throw new EventError((e as Error).message); }
    statements.push(db.prepare('INSERT INTO practice_parties (starts_at, starts_utc, duration_minutes, recorded_by, recorded_at, request_key) VALUES (?, ?, ?, ?, ?, ?)').bind(session.startsAt, session.startsUtc, session.durationMinutes, email, now, key));
    statements.push(db.prepare('INSERT INTO practice_requests (request_key, practice_id, payload, recorded_by, recorded_at) VALUES (?, (SELECT id FROM practice_parties WHERE request_key = ?), ?, ?, ?)').bind(key, key, payload, email, now));
  } else {
    const party = await readEvent(id);
    if (!Number.isInteger(input.revision) || input.revision !== party.revision) throw new EventError('This practice party changed. Reload before saving.', 409);
    statements.push(db.prepare('INSERT INTO practice_requests (request_key, practice_id, payload, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?)').bind(key, id, payload, email, now));
    statements.push(db.prepare('UPDATE practice_parties SET revision = revision + 1 WHERE id = ? AND revision = ?').bind(id, party.revision));
    statements.push(db.prepare('UPDATE practice_requests SET verified = changes() WHERE request_key = ?').bind(key));
    if (action === 'edit_session' || action === 'cancel_session') {
      const reason = cleanText(input.reason, 1000, true);
      if (action === 'cancel_session') {
        if (typeof input.cancelled !== 'boolean') throw new EventError('Choose cancel or restore.');
        statements.push(db.prepare('UPDATE practice_parties SET cancelled = ? WHERE id = ?').bind(input.cancelled ? 1 : 0, id));
      } else {
        let s; try { s = parseSession(input.session); } catch (e) { throw new EventError((e as Error).message); }
        statements.push(db.prepare('UPDATE practice_parties SET starts_at = ?, starts_utc = ?, duration_minutes = ? WHERE id = ?').bind(s.startsAt, s.startsUtc, s.durationMinutes, id));
      }
      statements.push(db.prepare('INSERT INTO practice_changes (practice_id, before_json, after_json, reason, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, JSON.stringify(party), JSON.stringify(input.session ?? { cancelled: input.cancelled }), reason, email, now));
    } else if (action === 'attendance_batch') {
      if (party.cancelled) throw new EventError('Restore the cancelled practice party before recording participation.', 409);
      if (!Array.isArray(input.addStudentIds) || !Array.isArray(input.removeAttendanceIds) || !Array.isArray(input.donations) || input.addStudentIds.length + input.removeAttendanceIds.length + input.donations.length < 1 || input.addStudentIds.length + input.removeAttendanceIds.length + input.donations.length > 500) throw new EventError('Select up to 500 attendance changes or donations.');
      const add = input.addStudentIds.map(positiveId), remove = input.removeAttendanceIds.map(positiveId);
      if (new Set(add).size !== add.length || new Set(remove).size !== remove.length || add.some(student => remove.includes(student))) throw new EventError('Choose each student once.');
      for (const student of add) statements.push(db.prepare('INSERT INTO practice_attendance (student_id, practice_id, original_starts_at, recorded_by, recorded_at, notes) VALUES (?, ?, ?, ?, ?, ?)').bind(student, id, party.startsAt, email, now, ''));
      for (const attendanceId of remove) statements.push(db.prepare('UPDATE practice_attendance SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND practice_id = ? AND voided_at IS NULL').bind(now, email, 'Attendance corrected from practice party roster.', attendanceId, id));
      const donations = input.donations as unknown[];
      const donationStudents = new Set<number>();
      for (let index = 0; index < donations.length; index++) {
        const donation = donations[index] as Record<string, unknown>;
        const student = positiveId(donation?.studentId), amount = parseAmount(donation?.amount);
        if (amount === null || donationStudents.has(student)) throw new EventError('Enter one positive donation per student.');
        donationStudents.add(student);
        const donationKey = `${key}-d${index}`;
        statements.push(db.prepare('INSERT INTO practice_requests (request_key, practice_id, payload, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?)').bind(donationKey, id, payload, email, now));
        statements.push(db.prepare('INSERT INTO practice_donations (student_id, paid_on, amount_minor, notes, recorded_by, recorded_at, request_key, practice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(student, new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' }), amount, '', email, now, donationKey, id));
      }
    } else if (action === 'attendance' || action === 'donation') {
      const student = positiveId(input.studentId);
      if (party.cancelled) throw new EventError('Restore the cancelled practice party before recording participation.', 409);
      const notes = cleanText(input.notes, 1000);
      if (action === 'attendance') {
        statements.push(db.prepare('INSERT INTO practice_attendance (student_id, practice_id, original_starts_at, recorded_by, recorded_at, notes) VALUES (?, ?, ?, ?, ?, ?)').bind(student, id, party.startsAt, email, now, notes));
      }
      if (action === 'donation' || (input.amount !== '' && input.amount !== undefined)) {
        const amount = parseAmount(input.amount);
        if (amount === null || !validPaymentDate(input.paidOn)) throw new EventError('Enter a positive donation and a payment date up to today.');
        statements.push(db.prepare('INSERT INTO practice_donations (student_id, paid_on, amount_minor, notes, recorded_by, recorded_at, request_key, practice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(student, input.paidOn, amount, notes, email, now, key, id));
      }
    } else if (action === 'void_attendance') {
      const aid = positiveId(input.attendanceId);
      const found = await db.prepare('SELECT id FROM practice_attendance WHERE id = ? AND practice_id = ? AND voided_at IS NULL').bind(aid, id).first();
      if (!found) throw new EventError('Active attendance not found.', 404);
      statements.push(db.prepare('UPDATE practice_attendance SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?').bind(now, email, cleanText(input.reason, 1000, true), aid));
    } else if (['edit_donation', 'delete_donation', 'handover'].includes(action)) {
      const pid = positiveId(input.paymentId);
      const payment = await db.prepare('SELECT id FROM practice_donations WHERE id = ? AND practice_id = ?').bind(pid, id).first();
      if (!payment) throw new EventError('Donation not found.', 404);
      if (action === 'delete_donation') statements.push(db.prepare('DELETE FROM practice_donations WHERE id = ? AND practice_id = ?').bind(pid, id));
      else if (action === 'handover') {
        if (typeof input.givenToSchool !== 'boolean') throw new EventError('Choose the school transfer status.');
        statements.push(db.prepare('UPDATE practice_donations SET given_to_school = ? WHERE id = ? AND practice_id = ?').bind(input.givenToSchool ? 1 : 0, pid, id));
      } else {
        const amount = parseAmount(input.amount);
        if (amount === null || !validPaymentDate(input.paidOn)) throw new EventError('Enter a positive donation and a payment date up to today.');
        statements.push(db.prepare('UPDATE practice_donations SET amount_minor = ?, paid_on = ?, notes = ? WHERE id = ? AND practice_id = ?').bind(amount, input.paidOn, cleanText(input.notes, 1000), pid, id));
      }
    } else throw new EventError('Unknown practice-party action.');
  }
  statements.push(db.prepare('SELECT practice_id AS id FROM practice_requests WHERE request_key = ?').bind(key));
  const result = await db.batch(statements);
  return eventJson(result.at(-1)!.results[0], 201);
}
