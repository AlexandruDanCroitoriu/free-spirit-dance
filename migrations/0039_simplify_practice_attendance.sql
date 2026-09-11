-- A single attendance can contain one optional donation. Stop before changing
-- records if legacy donations cannot be moved without losing their identity.
CREATE TABLE practice_migration_guard (safe INTEGER NOT NULL CHECK (safe = 1));
INSERT INTO practice_migration_guard (safe)
SELECT CASE WHEN
  EXISTS (SELECT 1 FROM practice_donations GROUP BY student_id, practice_id HAVING COUNT(*) > 1)
  OR EXISTS (SELECT 1 FROM practice_donations d WHERE NOT EXISTS (
    SELECT 1 FROM practice_attendance a WHERE a.student_id = d.student_id
      AND a.practice_id = d.practice_id AND a.voided_at IS NULL
  )) THEN 0 ELSE 1 END;
DROP TABLE practice_migration_guard;

ALTER TABLE practice_parties ADD COLUMN request_hash TEXT;
ALTER TABLE practice_parties ADD COLUMN last_request_key TEXT;
ALTER TABLE practice_parties ADD COLUMN last_request_hash TEXT;
-- Each mutation supplies the next expected revision. A stale write aborts the
-- whole D1 batch, including attendance and donation changes, without a log table.
CREATE TRIGGER practice_revision_matches BEFORE UPDATE OF revision ON practice_parties
WHEN NEW.revision != OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'Practice party changed. Reload before saving.'); END;

CREATE TABLE practice_attendance_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  practice_id INTEGER NOT NULL REFERENCES practice_parties(id),
  recorded_by TEXT NOT NULL REFERENCES admin_profiles(email),
  recorded_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  donation_amount_minor INTEGER CHECK (donation_amount_minor IS NULL OR (typeof(donation_amount_minor) = 'integer' AND donation_amount_minor BETWEEN 1 AND 99999999)),
  donation_paid_on TEXT,
  donation_notes TEXT NOT NULL DEFAULT '',
  donation_recorded_by TEXT REFERENCES admin_profiles(email),
  donation_recorded_at TEXT,
  donation_given_to_school INTEGER NOT NULL DEFAULT 0 CHECK (donation_given_to_school IN (0, 1)),
  UNIQUE (student_id, practice_id),
  CHECK (
    (donation_amount_minor IS NULL AND donation_paid_on IS NULL AND donation_recorded_by IS NULL AND donation_recorded_at IS NULL AND donation_notes = '' AND donation_given_to_school = 0)
    OR (donation_amount_minor IS NOT NULL AND donation_paid_on IS NOT NULL AND donation_recorded_by IS NOT NULL AND donation_recorded_at IS NOT NULL)
  )
);
INSERT INTO practice_attendance_new (
  id, student_id, practice_id, recorded_by, recorded_at, notes,
  donation_amount_minor, donation_paid_on, donation_notes, donation_recorded_by, donation_recorded_at, donation_given_to_school
)
SELECT a.id, a.student_id, a.practice_id, a.recorded_by, a.recorded_at, a.notes,
  d.amount_minor, d.paid_on, COALESCE(d.notes, ''), d.recorded_by, d.recorded_at, COALESCE(d.given_to_school, 0)
FROM practice_attendance a LEFT JOIN practice_donations d ON d.student_id = a.student_id AND d.practice_id = a.practice_id
WHERE a.voided_at IS NULL;
-- Preserve the high-water mark even when the last attendance was removed.
INSERT INTO sqlite_sequence (name, seq)
SELECT 'practice_attendance_new', seq FROM sqlite_sequence WHERE name = 'practice_attendance'
  AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'practice_attendance_new');
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'practice_attendance'), 0))
WHERE name = 'practice_attendance_new';

DROP VIEW school_payment_records;
DROP TABLE practice_donations;
DROP TABLE practice_requests;
DROP TABLE practice_changes;
DROP TABLE practice_attendance;
ALTER TABLE practice_attendance_new RENAME TO practice_attendance;
CREATE INDEX practice_attendance_party_idx ON practice_attendance (practice_id, id);
CREATE INDEX practice_attendance_donation_date_idx ON practice_attendance (donation_paid_on, id) WHERE donation_amount_minor IS NOT NULL;
CREATE TRIGGER practice_attendance_keeps_donation BEFORE DELETE ON practice_attendance
WHEN OLD.donation_amount_minor IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Remove the donation before removing attendance.'); END;
CREATE VIEW school_payment_records AS
SELECT p.id, 'course' AS purpose, NULL AS practice_id, NULL AS practice_description,
  p.student_id, p.paid_on, p.amount_minor, p.recorded_by, p.given_to_school
FROM student_payments p
UNION ALL
SELECT a.id, 'practice_donation', a.practice_id, 'Practice party · ' || s.starts_at,
  a.student_id, a.donation_paid_on, a.donation_amount_minor, a.donation_recorded_by, a.donation_given_to_school
FROM practice_attendance a JOIN practice_parties s ON s.id = a.practice_id
WHERE a.donation_amount_minor IS NOT NULL;
