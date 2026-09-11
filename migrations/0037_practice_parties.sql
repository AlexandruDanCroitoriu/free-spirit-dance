ALTER TABLE administrator_permissions ADD COLUMN can_practice_parties INTEGER NOT NULL DEFAULT 0 CHECK (can_practice_parties IN (0, 1));
CREATE TABLE practice_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_at TEXT NOT NULL,
  starts_utc TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0,
  recorded_by TEXT NOT NULL REFERENCES admin_profiles(email),
  recorded_at TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE
);
CREATE INDEX practice_parties_date_idx ON practice_parties (starts_at, id);
CREATE TABLE practice_requests (
  request_key TEXT PRIMARY KEY,
  practice_id INTEGER NOT NULL REFERENCES practice_parties(id),
  payload TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES admin_profiles(email),
  recorded_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 1 CHECK (verified = 1)
);
CREATE TABLE practice_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  practice_id INTEGER NOT NULL REFERENCES practice_parties(id),
  original_starts_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES admin_profiles(email),
  recorded_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  voided_at TEXT,
  voided_by TEXT REFERENCES admin_profiles(email),
  void_reason TEXT
);
CREATE UNIQUE INDEX practice_attendance_active_idx ON practice_attendance (student_id, practice_id) WHERE voided_at IS NULL;
CREATE INDEX practice_attendance_student_idx ON practice_attendance (student_id, practice_id);
CREATE TABLE practice_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  practice_id INTEGER NOT NULL REFERENCES practice_parties(id),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES admin_profiles(email),
  recorded_at TEXT NOT NULL
);
CREATE TABLE practice_donations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  practice_id INTEGER NOT NULL REFERENCES practice_parties(id),
  paid_on TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 1 AND 99999999),
  notes TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL REFERENCES admin_profiles(email),
  recorded_at TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE REFERENCES practice_requests(request_key),
  given_to_school INTEGER NOT NULL DEFAULT 0 CHECK (given_to_school IN (0, 1))
);
CREATE INDEX practice_donations_student_idx ON practice_donations (student_id, paid_on, id);
CREATE INDEX practice_donations_party_idx ON practice_donations (practice_id, id);

CREATE VIEW school_payment_records AS
SELECT p.id, 'course' AS purpose, NULL AS practice_id, NULL AS practice_description,
  p.student_id, p.paid_on, p.amount_minor, p.recorded_by, p.given_to_school
FROM student_payments p
UNION ALL
SELECT p.id, 'practice_donation', p.practice_id, 'Practice party · ' || s.starts_at,
  p.student_id, p.paid_on, p.amount_minor, p.recorded_by, p.given_to_school
FROM practice_donations p JOIN practice_parties s ON s.id = p.practice_id;
