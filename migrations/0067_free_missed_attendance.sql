CREATE TABLE free_missed_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  granted_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  granted_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE (student_id, class_id)
);

CREATE INDEX free_missed_attendance_student_class ON free_missed_attendance (student_id, class_id);
