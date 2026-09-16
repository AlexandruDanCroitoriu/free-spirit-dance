"""Automatic-task upgrade and constraints against synthetic in-memory SQLite."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
for path in sorted((root / 'migrations').glob('*.sql')):
    if path.name >= '0056_automatic_tasks.sql':
        break
    db.executescript(path.read_text())
db.executescript("""
PRAGMA foreign_keys=ON;
INSERT INTO students(first_name,last_name,email,birth_date) VALUES ('Existing','Student','','2000-02-29');
INSERT INTO admin_profiles(email,name) VALUES ('admin@example.test','Admin');
INSERT INTO manual_tasks(title,student_id,sort_order,created_by,created_at,updated_by,updated_at,request_key,request_payload)
VALUES ('Keep me',1,5,'admin@example.test','2026-09-15','admin@example.test','2026-09-15','migration-auto-test','{}');
""")
before = {table: db.execute(f'SELECT * FROM {table}').fetchall() for table in ('students', 'manual_tasks', 'admin_profiles', 'task_board_state')}
db.executescript((root / 'migrations/0056_automatic_tasks.sql').read_text())
for table, records in before.items():
    assert db.execute(f'SELECT * FROM {table}').fetchall() == records
assert db.execute('SELECT COUNT(*) FROM task_rule_state').fetchone()[0] == 0
assert db.execute('SELECT COUNT(*) FROM automatic_task_occurrences').fetchone()[0] == 0
db.execute('UPDATE manual_tasks SET student_id=NULL')
db.execute("INSERT INTO task_rule_state VALUES ('event','2026-09-15','2026-09-15')")
sql = "INSERT INTO automatic_task_occurrences(rule_key,subject_key,occurrence_key,student_id,title,due_date,sort_order,created_at,updated_at) VALUES ('event','student:1','2027',1,'Event','2027-03-01',0,'2026-09-15','2026-09-15')"
db.execute(sql)
db.commit()

def rejected(sql, values=()):
    try:
        db.execute(sql, values)
    except sqlite3.IntegrityError:
        db.rollback()
    else:
        raise AssertionError('Invalid write accepted: ' + sql)

rejected(sql)  # Occurrence identity is unique regardless of row ID.
for status in ('todo', 'in_progress', 'done'):
    for dismissed in (0, 1):
        db.execute('UPDATE automatic_task_occurrences SET status=?, dismissed=?', (status, dismissed))
        db.commit()
        rejected('DELETE FROM students WHERE id=1')
for column, value in [('status', 'unknown'), ('dismissed', 2), ('unlinked', 1), ('sort_order', -1), ('sort_order', 0.5), ('title', ' '), ('due_date', '2027-02-29'), ('due_date', 'invalid')]:
    rejected(f'UPDATE automatic_task_occurrences SET {column}=?', (value,))
rejected("UPDATE task_rule_state SET evaluated_on='2026-09-14'")
rejected("UPDATE task_rule_state SET activated_on='2026-02-30'")
revision = db.execute('SELECT revision FROM task_board_state').fetchone()[0]
db.execute("UPDATE students SET active=0, birth_date='2000-03-01' WHERE id=1")
assert db.execute('SELECT revision FROM task_board_state').fetchone()[0] > revision
db.execute('UPDATE automatic_task_occurrences SET student_id=NULL, unlinked=1')
db.execute('DELETE FROM students WHERE id=1')
assert db.execute('SELECT subject_key,occurrence_key,unlinked FROM automatic_task_occurrences').fetchone() == ('student:1', '2027', 1)
assert db.execute('SELECT COUNT(*) FROM manual_tasks').fetchone()[0] == 1
assert not db.execute('PRAGMA foreign_key_check').fetchall()
db.close()
print('PASS: automatic-task migration preserves existing data, enforces occurrence identity/date/state/order constraints, invalidates source changes, and restricts every linked student deletion.')
