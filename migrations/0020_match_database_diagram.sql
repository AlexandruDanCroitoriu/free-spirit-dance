-- Match docs/database.drawio; preserve retained columns, IDs, and weekly schedules.

-- A private production backup is required before applying this migration.

CREATE TABLE _migration_course_schedule AS SELECT id AS course_id, day_one AS day_of_week, start_time_one AS start_time, end_time_one AS end_time FROM courses UNION ALL SELECT id, day_two, start_time_two, end_time_two FROM courses WHERE day_two IS NOT NULL;

CREATE TABLE _migration_sequences AS SELECT name, seq FROM sqlite_sequence;

CREATE TABLE _migration_students AS SELECT id, first_name, last_name, email, phone, picture, active FROM students;

DROP TABLE students;

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  picture TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE INDEX students_name_idx ON students (last_name, first_name);
CREATE UNIQUE INDEX students_phone_unique_idx
ON students (trim(phone))
WHERE trim(phone) <> '';

INSERT INTO students (id, first_name, last_name, email, phone, picture, active) SELECT id, first_name, last_name, email, phone, picture, active FROM _migration_students;

DROP TABLE _migration_students;

CREATE TABLE _migration_admin_profiles AS SELECT email, name, picture FROM admin_profiles;

DROP TABLE admin_profiles;

CREATE TABLE admin_profiles (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT NOT NULL,
  picture TEXT
);



INSERT INTO admin_profiles (email, name, picture) SELECT email, name, picture FROM _migration_admin_profiles;

DROP TABLE _migration_admin_profiles;

CREATE TABLE _migration_administrator_permissions AS SELECT email, can_dashboard, can_students, can_courses, can_qr_codes FROM administrator_permissions;

DROP TABLE administrator_permissions;

CREATE TABLE administrator_permissions (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  can_dashboard INTEGER NOT NULL DEFAULT 0 CHECK (can_dashboard IN (0, 1)),
  can_students INTEGER NOT NULL DEFAULT 0 CHECK (can_students IN (0, 1)),
  can_courses INTEGER NOT NULL DEFAULT 0 CHECK (can_courses IN (0, 1)),
  can_qr_codes INTEGER NOT NULL DEFAULT 0 CHECK (can_qr_codes IN (0, 1))
);



INSERT INTO administrator_permissions (email, can_dashboard, can_students, can_courses, can_qr_codes) SELECT email, can_dashboard, can_students, can_courses, can_qr_codes FROM _migration_administrator_permissions;

DROP TABLE _migration_administrator_permissions;

CREATE TABLE _migration_qr_codes AS SELECT id, slug, name, destination_url, active, image_mode, image_path, module_shape, foreground_color, eye_shape, eye_color, logo_size, logo_shape FROM qr_codes;

DROP TABLE qr_codes;

CREATE TABLE "qr_codes" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  image_mode TEXT NOT NULL DEFAULT 'none' CHECK (image_mode IN ('none', 'logo', 'custom')),
  image_path TEXT,
  module_shape TEXT NOT NULL DEFAULT 'square' CHECK (module_shape IN ('square', 'circle')),
  foreground_color TEXT NOT NULL DEFAULT '#1e293b',
  eye_shape TEXT NOT NULL DEFAULT 'square' CHECK (eye_shape IN ('square', 'rounded', 'circle')),
  eye_color TEXT NOT NULL DEFAULT '#1e293b',
  logo_size INTEGER NOT NULL DEFAULT 25 CHECK (logo_size BETWEEN 15 AND 30),
  logo_shape TEXT NOT NULL DEFAULT 'square' CHECK (logo_shape IN ('square', 'rounded', 'circle'))
);



INSERT INTO qr_codes (id, slug, name, destination_url, active, image_mode, image_path, module_shape, foreground_color, eye_shape, eye_color, logo_size, logo_shape) SELECT id, slug, name, destination_url, active, image_mode, image_path, module_shape, foreground_color, eye_shape, eye_color, logo_size, logo_shape FROM _migration_qr_codes;

DROP TABLE _migration_qr_codes;

CREATE TABLE _migration_courses AS SELECT id, name FROM courses;

DROP TABLE courses;

CREATE TABLE "courses" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0)
);

CREATE INDEX courses_name_idx ON courses (name COLLATE NOCASE);

INSERT INTO courses (id, name) SELECT id, name FROM _migration_courses;

DROP TABLE _migration_courses;

UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM _migration_sequences WHERE name = sqlite_sequence.name), seq));

DROP TABLE _migration_sequences;

CREATE TABLE course_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(start_time, 1, 2) AS INTEGER) <= 23),
  end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(end_time, 1, 2) AS INTEGER) <= 23),
  CHECK (end_time > start_time),
  UNIQUE (course_id, day_of_week, start_time)
);

CREATE TABLE subscription (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0)
);

CREATE TABLE subscription_courses (
  subscription_id INTEGER NOT NULL REFERENCES subscription(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  entries INTEGER NOT NULL CHECK (typeof(entries) = 'integer' AND entries > 0),
  PRIMARY KEY (subscription_id, course_id)
);

CREATE INDEX subscription_courses_course_idx ON subscription_courses (course_id);
-- Require at least one course per subscription in application validation.

CREATE TABLE student_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  subscription_id INTEGER NOT NULL REFERENCES subscription(id),
  starts_on TEXT NOT NULL,
  paid_at TEXT,
  UNIQUE (id, student_id)
);
CREATE INDEX student_subscriptions_student_idx ON student_subscriptions (student_id);
CREATE INDEX student_subscriptions_subscription_idx ON student_subscriptions (subscription_id);

CREATE TABLE student_course_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
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

CREATE TABLE attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_course_entry_id INTEGER NOT NULL REFERENCES student_course_entries(id),
  attended_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email)
);
CREATE INDEX attendance_entry_idx ON attendance (student_course_entry_id, attended_at);
CREATE INDEX attendance_admin_idx ON attendance (recorded_by);
-- Each row consumes one entry. Validate available balance and starts_on atomically.
-- paid_at is informational and must not block attendance.

INSERT INTO course_schedule (course_id, day_of_week, start_time, end_time) SELECT course_id, day_of_week, start_time, end_time FROM _migration_course_schedule;

DROP TABLE _migration_course_schedule;
