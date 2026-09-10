-- Attendance belongs directly to a student and course, regardless of payment balance.
-- Retain previous grants in student_course_entries: they are not proof of payment.
CREATE TABLE _activity_attendance AS
SELECT a.id, e.student_id, a.course_id, c.name AS course_name, a.attended_at, a.recorded_by
FROM attendance a JOIN student_course_entries e ON e.id = a.student_course_entry_id
JOIN courses c ON c.id = a.course_id;
CREATE TABLE _activity_sequence AS SELECT seq FROM sqlite_sequence WHERE name = 'attendance';
DROP TABLE attendance;
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  course_name TEXT NOT NULL,
  attended_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  recorded_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  request_key TEXT UNIQUE,
  request_payload TEXT
);
CREATE INDEX attendance_student_idx ON attendance (student_id, attended_at, id);
CREATE INDEX attendance_course_idx ON attendance (course_id, attended_at);
CREATE INDEX attendance_admin_idx ON attendance (recorded_by);
-- Preserve legacy duplicates; enforce one new attendance per student/course/class time.
CREATE UNIQUE INDEX attendance_class_unique_idx ON attendance (student_id, course_id, attended_at) WHERE request_key IS NOT NULL;
INSERT INTO attendance (id, student_id, course_id, course_name, attended_at, recorded_by)
SELECT id, student_id, course_id, course_name, attended_at, recorded_by FROM _activity_attendance;
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM _activity_sequence), seq)) WHERE name = 'attendance';
DROP TABLE _activity_attendance;
DROP TABLE _activity_sequence;

CREATE TABLE student_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  paid_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 1 AND 99999999),
  notes TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  recorded_at TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_payload TEXT NOT NULL
);
CREATE INDEX student_payments_student_idx ON student_payments (student_id, paid_on, id);
CREATE INDEX student_payments_admin_idx ON student_payments (recorded_by);
CREATE TABLE payment_course_allowances (
  payment_id INTEGER NOT NULL REFERENCES student_payments(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  course_name TEXT NOT NULL,
  allowance INTEGER NOT NULL CHECK (typeof(allowance) = 'integer' AND allowance BETWEEN 1 AND 10000),
  PRIMARY KEY (payment_id, course_id)
);
CREATE INDEX payment_course_allowances_course_idx ON payment_course_allowances (course_id);

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
