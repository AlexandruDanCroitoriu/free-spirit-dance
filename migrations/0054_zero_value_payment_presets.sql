-- A course can grant class credit before its price is decided, so its preset
-- must be able to carry a zero amount.
PRAGMA defer_foreign_keys = ON;

-- DROP TABLE invokes cascading deletes even with deferred foreign keys in D1.
CREATE TABLE _preset_allowances AS SELECT * FROM payment_preset_courses;
CREATE TABLE _preset_sequence AS SELECT seq FROM sqlite_sequence WHERE name = 'payment_presets';

CREATE TABLE payment_presets_rebuilt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  amount_minor INTEGER NOT NULL CHECK (typeof(amount_minor) = 'integer' AND amount_minor BETWEEN 0 AND 99999999),
  course_id INTEGER REFERENCES courses(id)
);

INSERT INTO payment_presets_rebuilt (id, name, amount_minor, course_id)
SELECT id, name, amount_minor, course_id FROM payment_presets;

DROP TABLE payment_presets;
ALTER TABLE payment_presets_rebuilt RENAME TO payment_presets;

CREATE UNIQUE INDEX payment_presets_name_idx ON payment_presets (name COLLATE NOCASE);
CREATE UNIQUE INDEX payment_presets_course_idx ON payment_presets (course_id) WHERE course_id IS NOT NULL;

INSERT OR IGNORE INTO payment_preset_courses SELECT * FROM _preset_allowances;
DROP TABLE _preset_allowances;
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM _preset_sequence), seq)) WHERE name = 'payment_presets';
DROP TABLE _preset_sequence;

PRAGMA defer_foreign_keys = OFF;
