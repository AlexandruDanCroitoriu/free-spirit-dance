"""Named board/list upgrade against synthetic data only."""
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
for migration in sorted((root / 'migrations').glob('*.sql')):
    if migration.name >= '0057_task_boards_and_lists.sql':
        break
    db.executescript(migration.read_text())
db.executescript("""
PRAGMA foreign_keys=ON;
INSERT INTO students(first_name,last_name,email) VALUES ('Synthetic','Student','');
INSERT INTO admin_profiles(email,name) VALUES ('admin@example.test','Admin');
INSERT INTO manual_tasks(title,status,student_id,sort_order,created_by,created_at,updated_by,updated_at,request_key,request_payload)
VALUES ('Preserve','done',1,7,'admin@example.test','2026-09-16','admin@example.test','2026-09-16','board-migration-test','{}');
INSERT INTO automatic_task_occurrences(rule_key,subject_key,occurrence_key,student_id,title,status,dismissed,sort_order,created_at,updated_at)
VALUES ('event','student:1','2026',1,'Event','in_progress',1,9,'2026-09-16','2026-09-16');
""")
before = {table: db.execute(f'SELECT * FROM {table}').fetchall() for table in ('students','manual_tasks','automatic_task_occurrences')}
db.executescript((root / 'migrations/0057_task_boards_and_lists.sql').read_text())
assert db.execute('SELECT * FROM students').fetchall() == before['students']
for table in ('manual_tasks','automatic_task_occurrences'):
    assert [row[:-1] for row in db.execute(f'SELECT * FROM {table}')] == before[table]
assert db.execute('SELECT list_id FROM manual_tasks').fetchone() == (3,)
assert db.execute('SELECT list_id FROM automatic_task_occurrences').fetchone() == (2,)
assert db.execute('SELECT name FROM task_boards').fetchall() == [('Inbox',)]
assert db.execute('SELECT name FROM task_lists ORDER BY sort_order').fetchall() == [('Inbox',),('In Progress',),('Done',)]
for sql in ("UPDATE manual_tasks SET list_id=NULL", "UPDATE manual_tasks SET list_id=999", "DELETE FROM task_lists WHERE id=3", "INSERT INTO task_boards(name) VALUES (' ')"):
    try:
        db.execute(sql)
    except sqlite3.IntegrityError:
        db.rollback()
    else:
        raise AssertionError('Invalid write accepted: '+sql)
assert not db.execute('PRAGMA foreign_key_check').fetchall()
print('PASS: board migration retains task state, links and order; placement and names are constrained.')
