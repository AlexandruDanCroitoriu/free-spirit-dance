"""Retire generated storage and add private placement without changing manual work."""
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
for path in sorted((root / 'migrations').glob('*.sql')):
    if path.name.startswith('0058'): break
    db.executescript(path.read_text())
db.executescript("""
PRAGMA foreign_keys=ON;
INSERT INTO admin_profiles(email,name) VALUES ('admin@example.test','Admin');
INSERT INTO students(first_name,last_name,email,birth_date) VALUES ('Synthetic','Student','','2000-02-29');
INSERT INTO manual_tasks(title,student_id,sort_order,created_by,created_at,updated_by,updated_at,request_key,request_payload)
VALUES ('Preserved',1,7,'admin@example.test','2026-09-16','admin@example.test','2026-09-16','test-private-migration','{}');
INSERT INTO task_rule_state VALUES ('legacy','2026-09-16','2026-09-16');
INSERT INTO automatic_task_occurrences(rule_key,subject_key,occurrence_key,student_id,title,sort_order,created_at,updated_at)
VALUES ('legacy','student:1','2026',1,'Generated',0,'2026-09-16','2026-09-16');
""")
before = db.execute('SELECT * FROM manual_tasks').fetchall()
students = db.execute('SELECT * FROM students').fetchall()
db.executescript((root / 'migrations/0058_personal_task_inboxes.sql').read_text())
assert [row[:-1] for row in db.execute('SELECT * FROM manual_tasks')] == before
assert db.execute('SELECT * FROM students').fetchall() == students
assert not db.execute("SELECT name FROM sqlite_master WHERE name IN ('task_rule_state','automatic_task_occurrences','task_student_update_revision')").fetchall()
db.execute("UPDATE manual_tasks SET list_id=NULL,inbox_owner='admin@example.test'")
db.commit()
for sql in ["UPDATE manual_tasks SET list_id=1", "UPDATE manual_tasks SET inbox_owner=NULL", "UPDATE manual_tasks SET inbox_owner='unknown@example.test'", "DELETE FROM students WHERE id=1"]:
    try: db.execute(sql)
    except sqlite3.IntegrityError: db.rollback()
    else: raise AssertionError('Accepted invalid placement or deleted linked student')
db.execute('UPDATE manual_tasks SET student_id=NULL')
db.execute('DELETE FROM students WHERE id=1')
assert not db.execute('PRAGMA foreign_key_check').fetchall()
print('PASS: retirement removes generated storage; manual work, profiles, private placement, and restrictive links are preserved.')
