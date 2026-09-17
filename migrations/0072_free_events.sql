CREATE TABLE free_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  starts_on TEXT,
  ends_on TEXT,
  image_path TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES admin_profiles(email),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (starts_on IS NULL OR length(starts_on) = 10),
  CHECK (ends_on IS NULL OR length(ends_on) = 10),
  CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on <= ends_on)
);
CREATE INDEX free_events_dates_idx ON free_events (starts_on, ends_on, id);
CREATE TABLE free_event_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES free_events(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  starts_at TEXT NOT NULL,
  starts_utc TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  space_rent_minor INTEGER NOT NULL CHECK (typeof(space_rent_minor) = 'integer' AND space_rent_minor BETWEEN 0 AND 99999999),
  accepts_donations INTEGER NOT NULL DEFAULT 0 CHECK (accepts_donations IN (0, 1)),
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES admin_profiles(email),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX free_event_meetings_event_idx ON free_event_meetings (event_id, starts_at, id);
CREATE TABLE free_event_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES free_event_meetings(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  recorded_by TEXT NOT NULL REFERENCES admin_profiles(email),
  recorded_at TEXT NOT NULL,
  donation_amount_minor INTEGER CHECK (donation_amount_minor IS NULL OR (typeof(donation_amount_minor) = 'integer' AND donation_amount_minor BETWEEN 1 AND 99999999)),
  donation_received_method TEXT NOT NULL DEFAULT '',
  UNIQUE (meeting_id, student_id)
);
CREATE INDEX free_event_attendance_meeting_idx ON free_event_attendance (meeting_id, id);
CREATE TABLE free_event_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES free_events(id) ON DELETE CASCADE,
  administrator_email TEXT NOT NULL REFERENCES admin_profiles(email),
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX free_event_change_log_event_idx ON free_event_change_log (event_id, created_at DESC, id DESC);
CREATE TABLE free_meeting_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES free_event_meetings(id) ON DELETE CASCADE,
  administrator_email TEXT NOT NULL REFERENCES admin_profiles(email),
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX free_meeting_change_log_meeting_idx ON free_meeting_change_log (meeting_id, created_at DESC, id DESC);
