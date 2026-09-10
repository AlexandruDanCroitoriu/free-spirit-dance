CREATE TABLE class_cancellations (
  course_id INTEGER NOT NULL REFERENCES courses(id),
  class_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  cancelled_by TEXT NOT NULL REFERENCES admin_profiles(email),
  cancelled_at TEXT NOT NULL,
  PRIMARY KEY (course_id, class_date, start_time)
);
CREATE TRIGGER cancellation_requires_no_attendance BEFORE INSERT ON class_cancellations
WHEN EXISTS (SELECT 1 FROM attendance WHERE course_id = NEW.course_id AND attended_at = NEW.class_date || 'T' || NEW.start_time || ':00')
BEGIN SELECT RAISE(ABORT, 'Class already has attendance'); END;
CREATE TRIGGER attendance_requires_active_class BEFORE INSERT ON attendance
WHEN EXISTS (SELECT 1 FROM class_cancellations WHERE course_id = NEW.course_id AND class_date || 'T' || start_time || ':00' = NEW.attended_at)
BEGIN SELECT RAISE(ABORT, 'Class is cancelled'); END;
