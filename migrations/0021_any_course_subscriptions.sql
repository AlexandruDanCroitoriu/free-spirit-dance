-- Existing options remain per-course. Any-course options have one shared allowance.
ALTER TABLE subscription ADD COLUMN allowance_type TEXT NOT NULL DEFAULT 'per_course'
  CHECK (allowance_type IN ('per_course', 'any_course'));
ALTER TABLE subscription ADD COLUMN shared_entries INTEGER
  CHECK ((allowance_type = 'per_course' AND shared_entries IS NULL)
    OR (allowance_type = 'any_course' AND shared_entries IS NOT NULL
      AND typeof(shared_entries) = 'integer' AND shared_entries > 0));

-- Rebuild dependent tables without losing grants, attendance, or ID high-water marks.
CREATE TABLE _any_course_sequences AS SELECT name, seq FROM sqlite_sequence;
CREATE TABLE _any_course_attendance AS
  SELECT a.id, a.student_course_entry_id, e.course_id, a.attended_at, a.recorded_by
  FROM attendance a JOIN student_course_entries e ON e.id = a.student_course_entry_id;
CREATE TABLE _any_course_entries AS SELECT * FROM student_course_entries;
DROP TABLE attendance;
DROP TABLE student_course_entries;
CREATE TABLE student_course_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  course_id INTEGER REFERENCES courses(id),
  student_subscription_id INTEGER,
  entries_granted INTEGER NOT NULL CHECK (typeof(entries_granted) = 'integer' AND entries_granted > 0),
  granted_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  granted_at TEXT NOT NULL,
  reason TEXT,
  FOREIGN KEY (student_subscription_id, student_id) REFERENCES student_subscriptions(id, student_id)
);
CREATE INDEX student_course_entries_student_course_idx ON student_course_entries (student_id, course_id);
CREATE INDEX student_course_entries_purchase_idx ON student_course_entries (student_subscription_id, student_id);
CREATE INDEX student_course_entries_course_idx ON student_course_entries (course_id);
CREATE INDEX student_course_entries_admin_idx ON student_course_entries (granted_by);
INSERT INTO student_course_entries SELECT * FROM _any_course_entries;
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_course_entry_id INTEGER NOT NULL REFERENCES student_course_entries(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  attended_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email)
);
CREATE INDEX attendance_entry_idx ON attendance (student_course_entry_id, attended_at);
CREATE INDEX attendance_admin_idx ON attendance (recorded_by);
-- Each row consumes one entry. Validate available balance and starts_on atomically.
-- paid_at is informational and must not block attendance.
CREATE INDEX attendance_course_idx ON attendance (course_id, attended_at);
-- Validate attendance.course_id against the allowance when its course_id is not NULL.

INSERT INTO attendance (id, student_course_entry_id, course_id, attended_at, recorded_by) SELECT id, student_course_entry_id, course_id, attended_at, recorded_by FROM _any_course_attendance;
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM _any_course_sequences WHERE name = sqlite_sequence.name), seq));
DROP TABLE _any_course_attendance;
DROP TABLE _any_course_entries;
DROP TABLE _any_course_sequences;
