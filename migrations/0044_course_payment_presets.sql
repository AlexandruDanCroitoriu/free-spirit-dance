-- Course-owned presets are edited with their course, not in the shared preset editor.
ALTER TABLE payment_presets ADD COLUMN course_id INTEGER REFERENCES courses(id);
CREATE UNIQUE INDEX payment_presets_course_idx ON payment_presets (course_id) WHERE course_id IS NOT NULL;
