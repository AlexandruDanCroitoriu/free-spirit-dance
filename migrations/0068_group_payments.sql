-- One financial record; group members each receive the full course allowances.
ALTER TABLE payment_presets ADD COLUMN student_count INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(student_count) = 'integer' AND student_count BETWEEN 1 AND 10000);
ALTER TABLE student_payments ADD COLUMN student_count INTEGER NOT NULL DEFAULT 1
  CHECK (typeof(student_count) = 'integer' AND student_count BETWEEN 1 AND 10000);
CREATE TABLE payment_students (
  payment_id INTEGER NOT NULL REFERENCES student_payments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  PRIMARY KEY (payment_id, student_id)
);
CREATE INDEX payment_students_student_idx ON payment_students(student_id, payment_id);
-- Single payments remain compatible with existing imports and course presets.
CREATE VIEW student_payment_coverage AS
SELECT id AS payment_id, student_id FROM student_payments WHERE student_count = 1
UNION ALL
SELECT ps.payment_id, ps.student_id FROM payment_students ps
JOIN student_payments p ON p.id = ps.payment_id WHERE p.student_count > 1;

DROP VIEW student_course_balances;
CREATE VIEW student_course_balances AS
WITH pairs AS (
  SELECT student_id, course_id FROM student_courses
  UNION SELECT student_id, course_id FROM attendance
  UNION SELECT p.student_id, a.course_id FROM payment_course_allowances a JOIN student_payment_coverage p ON p.payment_id = a.payment_id
), totals AS (
  SELECT pairs.student_id, pairs.course_id,
    (SELECT COUNT(*) FROM attendance a WHERE a.student_id = pairs.student_id AND a.course_id = pairs.course_id) AS attendance_count,
    (SELECT COALESCE(SUM(a.allowance), 0) FROM payment_course_allowances a JOIN student_payment_coverage p ON p.payment_id = a.payment_id WHERE p.student_id = pairs.student_id AND a.course_id = pairs.course_id) AS paid_allowance
  FROM pairs
)
SELECT student_id, course_id, attendance_count, paid_allowance,
  paid_allowance - attendance_count AS remaining_allowance,
  MAX(attendance_count - paid_allowance, 0) AS excess_attendance FROM totals;

