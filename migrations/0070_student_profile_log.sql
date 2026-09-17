CREATE TABLE student_profile_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  administrator_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'changed', 'course_added', 'course_removed')),
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX student_profile_log_student_idx ON student_profile_log (student_id, created_at DESC, id DESC);
