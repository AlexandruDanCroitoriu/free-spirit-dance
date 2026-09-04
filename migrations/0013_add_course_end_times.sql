CREATE TABLE courses_with_time_ranges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  recurrence_one TEXT NOT NULL CHECK (recurrence_one IN ('weekly', 'twice_weekly')),
  day_one TEXT NOT NULL CHECK (day_one IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  start_time_one TEXT NOT NULL CHECK (start_time_one GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(start_time_one, 1, 2) AS INTEGER) <= 23),
  end_time_one TEXT NOT NULL CHECK (end_time_one GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(end_time_one, 1, 2) AS INTEGER) <= 23),
  recurrence_two TEXT CHECK (recurrence_two IS NULL OR recurrence_two = 'twice_weekly'),
  day_two TEXT CHECK (day_two IS NULL OR day_two IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  start_time_two TEXT CHECK (start_time_two IS NULL OR (start_time_two GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(start_time_two, 1, 2) AS INTEGER) <= 23)),
  end_time_two TEXT CHECK (end_time_two IS NULL OR (end_time_two GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(end_time_two, 1, 2) AS INTEGER) <= 23)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_time_one > start_time_one),
  CHECK ((recurrence_one = 'weekly' AND recurrence_two IS NULL AND day_two IS NULL AND start_time_two IS NULL AND end_time_two IS NULL) OR (recurrence_one = 'twice_weekly' AND recurrence_two = 'twice_weekly' AND day_two IS NOT NULL AND start_time_two IS NOT NULL AND end_time_two IS NOT NULL AND end_time_two > start_time_two))
);

INSERT INTO courses_with_time_ranges (id, name, recurrence_one, day_one, start_time_one, end_time_one, recurrence_two, day_two, start_time_two, end_time_two, created_at, updated_at)
SELECT id, name, recurrence_one, day_one, time_one, substr(time(time_one, '+1 hour'), 1, 5), recurrence_two, day_two, time_two, CASE WHEN time_two IS NULL THEN NULL ELSE substr(time(time_two, '+1 hour'), 1, 5) END, created_at, updated_at FROM courses;

DROP TABLE courses;
ALTER TABLE courses_with_time_ranges RENAME TO courses;
CREATE INDEX courses_name_idx ON courses (name COLLATE NOCASE);
