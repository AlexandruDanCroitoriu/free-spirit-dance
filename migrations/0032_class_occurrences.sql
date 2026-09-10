CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  class_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  cancelled_by TEXT REFERENCES admin_profiles(email),
  cancelled_at TEXT,
  UNIQUE (course_id, class_date, start_time)
);
INSERT INTO classes (course_id, class_date, start_time)
SELECT DISTINCT course_id, substr(attended_at, 1, 10), substr(attended_at, 12, 5) FROM attendance;
INSERT INTO classes (course_id, class_date, start_time, cancelled, cancelled_by, cancelled_at)
SELECT course_id, class_date, start_time, 1, cancelled_by, cancelled_at FROM class_cancellations
WHERE true ON CONFLICT (course_id, class_date, start_time) DO UPDATE SET
cancelled = 1, cancelled_by = excluded.cancelled_by, cancelled_at = excluded.cancelled_at;
UPDATE classes SET end_time = (
  SELECT end_time FROM course_schedule WHERE course_id = classes.course_id AND start_time = classes.start_time
  AND day_of_week = CASE strftime('%w', classes.class_date)
  WHEN '0' THEN 'Sunday' WHEN '1' THEN 'Monday' WHEN '2' THEN 'Tuesday' WHEN '3' THEN 'Wednesday'
  WHEN '4' THEN 'Thursday' WHEN '5' THEN 'Friday' WHEN '6' THEN 'Saturday' END LIMIT 1
);
ALTER TABLE attendance ADD COLUMN class_id INTEGER REFERENCES classes(id);
UPDATE attendance SET class_id = (SELECT id FROM classes WHERE course_id = attendance.course_id
AND class_date = substr(attendance.attended_at, 1, 10) AND start_time = substr(attendance.attended_at, 12, 5));
CREATE INDEX attendance_class_idx ON attendance (class_id);
DROP TRIGGER cancellation_requires_no_attendance;
DROP TRIGGER attendance_requires_active_class;
DROP TABLE class_cancellations;
CREATE TRIGGER attendance_requires_active_class BEFORE INSERT ON attendance
WHEN NOT EXISTS (SELECT 1 FROM classes WHERE id = NEW.class_id AND cancelled = 0
AND course_id = NEW.course_id AND class_date = substr(NEW.attended_at, 1, 10) AND start_time = substr(NEW.attended_at, 12, 5))
BEGIN SELECT RAISE(ABORT, 'Class is cancelled or invalid'); END;
CREATE TRIGGER cancellation_requires_no_attendance BEFORE UPDATE OF cancelled ON classes
WHEN NEW.cancelled = 1 AND EXISTS (SELECT 1 FROM attendance WHERE class_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Class already has attendance'); END;
