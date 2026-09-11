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
  return { email };
}

export async function eventHandler(work: () => Promise<Response>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof EventError) return eventJson({ error: error.message }, error.status);
    if (/no such table: (?:practice_|school_payment_records)|no such column: .*practice/i.test(String(error))) return eventJson({ error: 'Practice Parties are not set up in this database. Apply migration 0039 and restart local development.' }, 503);
    if (/UNIQUE|CHECK|FOREIGN KEY|NOT NULL/.test(String(error))) return eventJson({ error: 'The record changed or is no longer valid. Reload and retry.' }, 409);
    console.error('Practice-party operation failed', error instanceof Error ? error.name : 'Unknown error');
    return eventJson({ error: 'Could not save the practice party. Retry after reloading.' }, 500);
  }
}

export const sessionColumns = `s.id, s.starts_at AS startsAt, s.starts_utc AS startsUtc, s.duration_minutes AS durationMinutes, s.cancelled, s.revision,
  (SELECT COUNT(*) FROM practice_attendance a WHERE a.practice_id = s.id) AS attendanceCount`;

export async function readEvent(id: number) {
  const party = await env.DB.prepare(`SELECT ${sessionColumns}, s.last_request_key AS lastRequestKey, s.last_request_hash AS lastRequestHash FROM practice_parties s WHERE s.id = ?`).bind(id).first<import('./practice-parties').PracticeSession & { lastRequestKey: string | null; lastRequestHash: string | null }>();
  if (!party) throw new EventError('Practice party not found.', 404);
  return party;
}

export async function eventDetail(id: number) {
  const party = await readEvent(id);
  const payments = await env.DB.prepare(`SELECT a.id, a.student_id AS studentId, trim(s.first_name || ' ' || s.last_name) AS studentName, a.practice_id AS practiceId, a.donation_amount_minor AS amountMinor, a.donation_paid_on AS paidOn, a.donation_notes AS notes, a.donation_recorded_by AS recordedBy, a.donation_given_to_school AS givenToSchool FROM practice_attendance a JOIN students s ON s.id = a.student_id WHERE a.practice_id = ? AND a.donation_amount_minor IS NOT NULL ORDER BY a.donation_paid_on DESC, a.id DESC`).bind(id).all<import('./practice-parties').EventPayment>();
  const totals = payments.results.reduce((total, payment) => ({ receivedMinor: total.receivedMinor + payment.amountMinor, givenMinor: total.givenMinor + (payment.givenToSchool ? payment.amountMinor : 0), pendingMinor: total.pendingMinor + (payment.givenToSchool ? 0 : payment.amountMinor) }), { receivedMinor: 0, givenMinor: 0, pendingMinor: 0 });
  return { party, payments: payments.results, totals };
}

export async function mutateEvent(request: Request, id?: number) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new EventError('Cross-origin writes are not allowed.', 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new EventError('Send JSON practice-party details.', 415);
  const { email } = await eventAccess(request);
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!input || typeof input.requestKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey) || typeof input.action !== 'string') throw new EventError('Invalid save request.');
  const db = env.DB, now = new Date().toISOString(), key = input.requestKey;
  const requestHash = JSON.stringify({ practiceId: id ?? null, input, email });

  if (id === undefined) {
    if (input.action !== 'create') throw new EventError('Invalid practice-party action.');
    const previous = await db.prepare('SELECT id, request_hash AS requestHash FROM practice_parties WHERE request_key = ?').bind(key).first<{ id: number; requestHash: string }>();
    if (previous) {
      if (previous.requestHash !== requestHash) throw new EventError('This save key was already used for different details.', 409);
      return eventJson({ id: previous.id });
    }
    let session; try { session = parseSession(input.session); } catch (error) { throw new EventError((error as Error).message); }
    await db.batch([
      db.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email),
      db.prepare('INSERT INTO practice_parties (starts_at, starts_utc, duration_minutes, recorded_by, recorded_at, request_key, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(session.startsAt, session.startsUtc, session.durationMinutes, email, now, key, requestHash),
    ]);
    const created = await db.prepare('SELECT id FROM practice_parties WHERE request_key = ?').bind(key).first<{ id: number }>();
    return eventJson({ id: created!.id }, 201);
  }

  const party = await readEvent(id);
  if (party.lastRequestKey === key) {
    if (party.lastRequestHash !== requestHash) throw new EventError('This save key was already used for different details.', 409);
    return eventJson({ id });
  }
  if (!Number.isInteger(input.revision) || input.revision !== party.revision) throw new EventError('This practice party changed. Reload before saving.', 409);
  if (input.action === 'delete_session') {
    if (party.attendanceCount) throw new EventError('Remove all attendance before deleting this practice party.', 409);
    const result = await db.prepare(`DELETE FROM practice_parties
      WHERE id = ? AND revision = ?
        AND NOT EXISTS (SELECT 1 FROM practice_attendance WHERE practice_id = ?)`).bind(id, party.revision, id).run();
    if (!result.meta.changes) throw new EventError('This practice party changed or now has attendance. Reload before deleting.', 409);
    return eventJson({ id });
  }
  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO admin_profiles (email, name) VALUES (?, '') ON CONFLICT(email) DO NOTHING").bind(email),
    db.prepare('UPDATE practice_parties SET revision = revision + 1, last_request_key = ?, last_request_hash = ? WHERE id = ? AND revision = ?').bind(key, requestHash, id, party.revision),
  ];

  if (input.action === 'edit_session') {
    let session; try { session = parseSession(input.session); } catch (error) { throw new EventError((error as Error).message); }
    statements.push(db.prepare('UPDATE practice_parties SET starts_at = ?, starts_utc = ?, duration_minutes = ? WHERE id = ?').bind(session.startsAt, session.startsUtc, session.durationMinutes, id));
  } else if (input.action === 'cancel_session') {
    if (typeof input.cancelled !== 'boolean') throw new EventError('Choose cancel or restore.');
    statements.push(db.prepare('UPDATE practice_parties SET cancelled = ? WHERE id = ?').bind(input.cancelled ? 1 : 0, id));
  } else if (input.action === 'attendance_batch') {
    if (party.cancelled) throw new EventError('Restore the cancelled practice party before recording participation.', 409);
    if (!Array.isArray(input.addStudentIds) || !Array.isArray(input.removeAttendanceIds) || !Array.isArray(input.donations) || input.addStudentIds.length + input.removeAttendanceIds.length + input.donations.length < 1 || input.addStudentIds.length + input.removeAttendanceIds.length + input.donations.length > 500) throw new EventError('Select up to 500 attendance changes or donations.');
    const add = input.addStudentIds.map(positiveId), remove = input.removeAttendanceIds.map(positiveId);
    if (new Set(add).size !== add.length || new Set(remove).size !== remove.length || add.some(student => remove.includes(student))) throw new EventError('Choose each student once.');
    const donations = new Map<number, { amountMinor: number | null; paidOn: string | null; notes: string; receivedMethod: string }>();
    for (const raw of input.donations) {
      const donation = raw as Record<string, unknown>, student = positiveId(donation?.studentId), amountMinor = parseAmount(donation?.amount);
      const paidOn = typeof donation?.paidOn === 'string' ? donation.paidOn : new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/Bucharest' });
      if (donations.has(student)) throw new EventError('Enter one donation per attending student.');
      if (amountMinor === null && typeof donation?.amount === 'string' && donation.amount.trim() === '') donations.set(student, { amountMinor: null, paidOn: null, notes: '', receivedMethod: '' });
      else {
        const receivedMethod = cleanText(donation?.receivedMethod, 50, true);
        if (amountMinor === null || !validPaymentDate(paidOn) || !await db.prepare("SELECT method FROM administrator_payment_methods WHERE email = ? AND method = ? COLLATE NOCASE").bind(email, receivedMethod).first()) throw new EventError('Choose one of your payment methods for each donation.');
        donations.set(student, { amountMinor, paidOn, notes: cleanText(donation?.notes ?? '', 1000), receivedMethod });
      }
    }
    for (const student of add) statements.push(db.prepare('INSERT INTO practice_attendance (student_id, practice_id, recorded_by, recorded_at, notes) VALUES (?, ?, ?, ?, ?)').bind(student, id, email, now, ''));
    for (const attendanceId of remove) {
      statements.push(db.prepare("UPDATE practice_attendance SET donation_amount_minor = NULL, donation_paid_on = NULL, donation_notes = '', donation_recorded_by = NULL, donation_recorded_at = NULL, donation_received_method = '', donation_given_to_school = 0 WHERE id = ? AND practice_id = ?").bind(attendanceId, id));
      statements.push(db.prepare('DELETE FROM practice_attendance WHERE id = ? AND practice_id = ?').bind(attendanceId, id));
    }
    for (const [student, donation] of donations) statements.push(db.prepare('UPDATE practice_attendance SET donation_amount_minor = ?, donation_paid_on = ?, donation_notes = ?, donation_recorded_by = ?, donation_recorded_at = ?, donation_received_method = ?, donation_given_to_school = 0 WHERE student_id = ? AND practice_id = ?').bind(donation.amountMinor, donation.paidOn, donation.notes, donation.amountMinor === null ? null : email, donation.amountMinor === null ? null : now, donation.receivedMethod, student, id));
  } else {
    throw new EventError('Unknown practice-party action.');
  }
  const result = await db.batch(statements);
  if (!result[1].meta.changes) throw new EventError('This practice party changed. Reload before saving.', 409);
  return eventJson({ id }, 201);
}
