import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for migration in sorted(Path("migrations").glob("*.sql")):
    if migration.name >= "0032":
        break
    db.executescript(migration.read_text())
db.executescript("""
INSERT INTO admin_profiles (email,name) VALUES ('admin@test','Admin');
INSERT INTO students (first_name,last_name,email) VALUES ('Test','Student','student@test');
INSERT INTO courses (name) VALUES ('Zouk');
INSERT INTO course_schedule (course_id,day_of_week,start_time,end_time) VALUES (1,'Monday','18:00','19:00');
INSERT INTO attendance (student_id,course_id,course_name,attended_at,recorded_by,notes)
VALUES (1,1,'Zouk','2026-09-07T18:00:00','admin@test','Keep this note'),
(1,1,'Zouk','2026-09-07T18:00:00','admin@test','Legacy duplicate');
INSERT INTO class_cancellations VALUES (1,'2026-09-14','18:00','admin@test','2026-09-10T10:00:00Z');
""")
before = db.execute("SELECT * FROM attendance ORDER BY id").fetchall()
db.executescript(Path("migrations/0032_class_occurrences.sql").read_text())
after = db.execute("SELECT * FROM attendance ORDER BY id").fetchall()
assert [row[:-1] for row in after] == before
assert all(row[-1] is not None for row in after)
assert after[0][-1] == after[1][-1]
assert db.execute("SELECT COUNT(*) FROM classes").fetchone()[0] == 2
assert db.execute("SELECT cancelled,cancelled_by,end_time FROM classes WHERE class_date='2026-09-14'").fetchone() == (1,"admin@test","19:00")
assert not db.execute("PRAGMA foreign_key_check").fetchall()
assert not db.execute("SELECT 1 FROM sqlite_schema WHERE name='class_cancellations'").fetchone()
print("PASS: occurrence backfill, legacy duplicate preservation, cancellation metadata and foreign keys.")
