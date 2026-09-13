-- Historical class-credit records can have no monetary amount while still
-- granting valid course allowances. Preserve all payment IDs and audit data.
PRAGMA foreign_keys = OFF;

CREATE TABLE _student_payment_sequence AS
SELECT seq FROM sqlite_sequence WHERE name = 'student_payments';

CREATE TABLE student_payments_rebuilt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  paid_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 0 AND 99999999),
  notes TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  recorded_at TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_payload TEXT NOT NULL,
  given_to_school INTEGER NOT NULL DEFAULT 0 CHECK (given_to_school IN (0, 1)),
  received_method TEXT NOT NULL DEFAULT ''
);

INSERT INTO student_payments_rebuilt (id, student_id, paid_on, amount_minor, notes, recorded_by, recorded_at, request_key, request_payload, given_to_school, received_method)
SELECT id, student_id, paid_on, amount_minor, notes, recorded_by, recorded_at, request_key, request_payload, given_to_school, received_method
FROM student_payments;

DROP VIEW student_course_balances;
DROP VIEW school_payment_records;
DROP TABLE student_payments;
ALTER TABLE student_payments_rebuilt RENAME TO student_payments;

CREATE INDEX student_payments_student_idx ON student_payments (student_id, paid_on, id);
CREATE INDEX student_payments_admin_idx ON student_payments (recorded_by);
CREATE INDEX student_payments_date_idx ON student_payments (paid_on DESC, id DESC);

CREATE VIEW student_course_balances AS
WITH pairs AS (
  SELECT student_id, course_id FROM student_courses
  UNION SELECT student_id, course_id FROM attendance
  UNION SELECT p.student_id, a.course_id FROM payment_course_allowances a JOIN student_payments p ON p.id = a.payment_id
), totals AS (
  SELECT pairs.student_id, pairs.course_id,
    (SELECT COUNT(*) FROM attendance a WHERE a.student_id = pairs.student_id AND a.course_id = pairs.course_id) AS attendance_count,
    (SELECT COALESCE(SUM(a.allowance), 0) FROM payment_course_allowances a JOIN student_payments p ON p.id = a.payment_id WHERE p.student_id = pairs.student_id AND a.course_id = pairs.course_id) AS paid_allowance
  FROM pairs
)
SELECT student_id, course_id, attendance_count, paid_allowance,
  paid_allowance - attendance_count AS remaining_allowance,
  MAX(attendance_count - paid_allowance, 0) AS excess_attendance FROM totals;

CREATE VIEW school_payment_records AS
SELECT p.id, 'course' AS purpose, NULL AS practice_id, NULL AS practice_description,
  p.student_id, p.paid_on, p.amount_minor, p.recorded_by, p.received_method, p.given_to_school
FROM student_payments p
UNION ALL
SELECT a.id, 'practice_donation', a.practice_id, 'Practice party · ' || s.starts_at,
  a.student_id, a.donation_paid_on, a.donation_amount_minor, a.donation_recorded_by, a.donation_received_method, a.donation_given_to_school
FROM practice_attendance a JOIN practice_parties s ON s.id = a.practice_id
WHERE a.donation_amount_minor IS NOT NULL;

UPDATE sqlite_sequence
SET seq = MAX(seq, COALESCE((SELECT seq FROM _student_payment_sequence), seq))
WHERE name = 'student_payments';
DROP TABLE _student_payment_sequence;

PRAGMA foreign_keys = ON;
