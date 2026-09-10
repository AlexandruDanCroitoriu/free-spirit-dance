-- Reusable defaults only; recorded student payments retain their own values.
CREATE TABLE payment_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 1 AND 99999999)
);
CREATE UNIQUE INDEX payment_presets_name_idx ON payment_presets (name COLLATE NOCASE);
CREATE TABLE payment_preset_courses (
  preset_id INTEGER NOT NULL REFERENCES payment_presets(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  allowance INTEGER NOT NULL CHECK (typeof(allowance) = 'integer' AND allowance BETWEEN 1 AND 10000),
  PRIMARY KEY (preset_id, course_id)
);
CREATE INDEX payment_preset_courses_course_idx ON payment_preset_courses (course_id);
