"""Validate migration preservation and exact diagram SQL parity without printing records."""
import sqlite3
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
if len(sys.argv) > 1:
    db.executescript(Path(sys.argv[1]).read_text())
else:
    for migration in sorted((ROOT / "migrations").glob("*.sql")):
        if migration.name.startswith("0020"):
            break
        db.executescript(migration.read_text())
    db.execute("INSERT INTO students (first_name,last_name,email) VALUES ('Test','Student','test@example.test')")
    db.execute("INSERT INTO admin_profiles (email,name) VALUES ('admin@example.test','Test')")
    db.execute("INSERT INTO courses (name,recurrence_one,day_one,start_time_one,end_time_one,recurrence_two,day_two,start_time_two,end_time_two) VALUES ('Test','twice_weekly','Monday','18:00','19:00','twice_weekly','Thursday','19:00','20:00')")
    db.commit()
db.execute("PRAGMA foreign_keys=ON")
target = sqlite3.connect(":memory:")
for cell in ET.parse(ROOT / "docs/database.drawio").iter("mxCell"):
    if cell.get("id", "").startswith("sql-") and cell.get("value", "").startswith(("CREATE TABLE", "CREATE VIEW")):
        target.executescript(cell.get("value"))

def tables(connection):
    return {r[0] for r in connection.execute("SELECT name FROM sqlite_schema WHERE type='table'") if not r[0].startswith(("sqlite_", "_cf_", "d1_"))}

def definitions(connection):
    return {(r[0],r[1]): "".join(r[2].replace('"', "").split()) for r in connection.execute("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL")
            if not r[1].startswith(("sqlite_", "_cf_", "d1_"))}

preserved = {}
for table in tables(db):
    columns = ", ".join(r[1] for r in target.execute(f'PRAGMA table_info("{table}")') if r[1] in {c[1] for c in db.execute(f'PRAGMA table_info("{table}")')})
    preserved[table] = (columns, db.execute(f'SELECT {columns} FROM "{table}" ORDER BY 1').fetchall())
schedules = db.execute("SELECT id,day_one,start_time_one,end_time_one FROM courses UNION ALL SELECT id,day_two,start_time_two,end_time_two FROM courses WHERE day_two IS NOT NULL ORDER BY 1,2,3,4").fetchall()
sequences = dict(db.execute("SELECT name,seq FROM sqlite_sequence"))
db.executescript("BEGIN;\n" + (ROOT / "migrations/0020_match_database_diagram.sql").read_text() + "\nCOMMIT;")
for later in sorted((ROOT / "migrations").glob("*.sql")):
    if later.name > "0020_match_database_diagram.sql":
        db.executescript(later.read_text())
assert definitions(db) == definitions(target), "Schema does not match diagram"
for table,(columns,rows) in preserved.items():
    assert rows == db.execute(f'SELECT {columns} FROM "{table}" ORDER BY 1').fetchall(), f"Records changed: {table}"
assert schedules == db.execute("SELECT course_id,day_of_week,start_time,end_time FROM course_schedule ORDER BY 1,2,3,4").fetchall()
for name,seq in db.execute("SELECT name,seq FROM sqlite_sequence"):
    assert seq >= sequences.get(name,0), "ID sequence regressed"
assert not db.execute("PRAGMA foreign_key_check").fetchall()

assert not any("subscription" in name for name in tables(db))
assert "student_course_entries" not in tables(db)
print("PASS: exact diagram schema, retained records, course schedules, ID sequences, and foreign keys.")
