"""Verify the practice-party simplification preserves compatible legacy data."""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "migrations").glob("*.sql"))


def legacy_database():
    database = sqlite3.connect(":memory:")
    database.execute("PRAGMA foreign_keys=ON")
    for migration in MIGRATIONS:
        if migration.name >= "0039":
            break
        database.executescript(migration.read_text())
    database.executescript("""
      INSERT INTO students (first_name, last_name, email) VALUES ('Ana', 'Student', 'ana@example.test');
      INSERT INTO admin_profiles (email, name) VALUES ('admin@example.test', 'Admin');
      INSERT INTO practice_parties (starts_at, starts_utc, duration_minutes, recorded_by, recorded_at, request_key)
        VALUES ('2026-01-07T20:00', '2026-01-07T18:00:00.000Z', 120, 'admin@example.test', '2026-01-01T00:00:00.000Z', 'party-create-key');
      INSERT INTO practice_requests (request_key, practice_id, payload, recorded_by, recorded_at)
        VALUES ('attendance-key', 1, '{}', 'admin@example.test', '2026-01-01T00:00:00.000Z');
      INSERT INTO practice_attendance (student_id, practice_id, original_starts_at, recorded_by, recorded_at, notes)
        VALUES (1, 1, '2026-01-07T20:00', 'admin@example.test', '2026-01-01T00:00:00.000Z', 'Present');
      INSERT INTO practice_donations (student_id, practice_id, paid_on, amount_minor, notes, recorded_by, recorded_at, request_key, given_to_school)
        VALUES (1, 1, '2026-01-07', 3050, 'Thank you', 'admin@example.test', '2026-01-01T00:00:00.000Z', 'attendance-key', 1);
    """)
    return database


database = legacy_database()
database.executescript((ROOT / "migrations/0039_simplify_practice_attendance.sql").read_text())
attendance = database.execute("SELECT student_id, practice_id, notes, donation_amount_minor, donation_paid_on, donation_notes, donation_recorded_by, donation_given_to_school FROM practice_attendance").fetchone()
assert attendance == (1, 1, "Present", 3050, "2026-01-07", "Thank you", "admin@example.test", 1)
assert database.execute("SELECT amount_minor, given_to_school FROM school_payment_records WHERE purpose = 'practice_donation'").fetchone() == (3050, 1)
assert not database.execute("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name IN ('practice_requests', 'practice_changes', 'practice_donations')").fetchall()
assert not database.execute("PRAGMA foreign_key_check").fetchall()

incompatible = legacy_database()
incompatible.executescript("""
  INSERT INTO practice_requests (request_key, practice_id, payload, recorded_by, recorded_at)
    VALUES ('extra-donation-key', 1, '{}', 'admin@example.test', '2026-01-01T00:00:00.000Z');
  INSERT INTO practice_donations (student_id, practice_id, paid_on, amount_minor, notes, recorded_by, recorded_at, request_key)
    VALUES (1, 1, '2026-01-08', 100, '', 'admin@example.test', '2026-01-01T00:00:00.000Z', 'extra-donation-key');
""")
try:
    incompatible.executescript((ROOT / "migrations/0039_simplify_practice_attendance.sql").read_text())
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError("Migration must stop when two donations would collapse into one attendance.")

print("PASS: compatible practice attendance and donations migrate intact; incompatible legacy donations stop safely.")
