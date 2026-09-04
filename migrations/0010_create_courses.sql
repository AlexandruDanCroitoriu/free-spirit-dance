CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  day_one TEXT NOT NULL CHECK (day_one IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  time_one TEXT NOT NULL CHECK (time_one GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(time_one, 1, 2) AS INTEGER) <= 23),
  day_two TEXT CHECK (day_two IS NULL OR day_two IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  time_two TEXT CHECK (time_two IS NULL OR (time_two GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(time_two, 1, 2) AS INTEGER) <= 23)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((day_two IS NULL AND time_two IS NULL) OR (day_two IS NOT NULL AND time_two IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS courses_name_idx ON courses (name COLLATE NOCASE);
