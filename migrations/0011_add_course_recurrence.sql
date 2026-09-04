CREATE TABLE courses_with_recurrence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  recurrence_one TEXT NOT NULL CHECK (recurrence_one IN ('weekly', 'twice_weekly')),
  day_one TEXT NOT NULL,
  time_one TEXT NOT NULL CHECK (time_one GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(time_one, 1, 2) AS INTEGER) <= 23),
  recurrence_two TEXT CHECK (recurrence_two IS NULL OR recurrence_two = 'twice_weekly'),
  day_two TEXT,
  time_two TEXT CHECK (time_two IS NULL OR (time_two GLOB '[0-2][0-9]:[0-5][0-9]' AND CAST(substr(time_two, 1, 2) AS INTEGER) <= 23)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (day_one IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  CHECK ((recurrence_one = 'weekly' AND recurrence_two IS NULL AND day_two IS NULL AND time_two IS NULL) OR (recurrence_one = 'twice_weekly' AND recurrence_two = 'twice_weekly' AND day_two IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') AND time_two IS NOT NULL))
);

INSERT INTO courses_with_recurrence (id, name, recurrence_one, day_one, time_one, recurrence_two, day_two, time_two, created_at, updated_at)
SELECT id, name, CASE WHEN day_two IS NULL THEN 'weekly' ELSE 'twice_weekly' END, day_one, time_one, CASE WHEN day_two IS NULL THEN NULL ELSE 'twice_weekly' END, day_two, time_two, created_at, updated_at FROM courses;

DROP TABLE courses;
ALTER TABLE courses_with_recurrence RENAME TO courses;
CREATE INDEX courses_name_idx ON courses (name COLLATE NOCASE);
