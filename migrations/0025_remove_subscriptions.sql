-- Remove purchases and payments while retaining entry balances and attendance.
CREATE TABLE _remove_sequences AS SELECT name, seq FROM sqlite_sequence;
CREATE TABLE _remove_attendance AS SELECT * FROM attendance;
CREATE TABLE _remove_entries AS SELECT id, student_id, course_id, entries_granted, granted_by, granted_at, reason FROM student_course_entries;
DROP TABLE attendance;
DROP TABLE student_course_entries;
DROP TABLE subscription_payments;
DROP TABLE subscription_courses;
DROP TABLE student_subscriptions;
DROP TABLE subscription;
CREATE TABLE student_course_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  course_id INTEGER REFERENCES courses(id),
  entries_granted INTEGER NOT NULL CHECK (typeof(entries_granted) = 'integer' AND entries_granted > 0),
  granted_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  granted_at TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX student_course_entries_student_course_idx ON student_course_entries (student_id, course_id);
CREATE INDEX student_course_entries_course_idx ON student_course_entries (course_id);
CREATE INDEX student_course_entries_admin_idx ON student_course_entries (granted_by);

INSERT INTO student_course_entries (id, student_id, course_id, entries_granted, granted_by, granted_at, reason) SELECT id, student_id, course_id, entries_granted, granted_by, granted_at, reason FROM _remove_entries;
CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_course_entry_id INTEGER NOT NULL REFERENCES student_course_entries(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  attended_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email)
);
CREATE INDEX attendance_entry_idx ON attendance (student_course_entry_id, attended_at);
CREATE INDEX attendance_admin_idx ON attendance (recorded_by);
CREATE INDEX attendance_course_idx ON attendance (course_id, attended_at);


INSERT INTO attendance SELECT * FROM _remove_attendance;
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM _remove_sequences WHERE name = sqlite_sequence.name), seq));
DROP TABLE _remove_attendance;
DROP TABLE _remove_entries;
DROP TABLE _remove_sequences;
