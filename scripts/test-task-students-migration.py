"""Remove statuses and migrate single student references without losing task data."""
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
for path in sorted((root / 'migrations').glob('*.sql')):
    if path.name.startswith('0060'): break
    db.executescript(path.read_text())
db.executescript("""
PRAGMA foreign_keys=ON;
INSERT INTO admin_profiles(email,name) VALUES ('admin@example.test','Admin');
INSERT INTO students(id,first_name,last_name,email) VALUES (1,'One','Student',''),(2,'Two','Student','');
INSERT INTO manual_tasks(title,status,student_id,sort_order,created_by,created_at,updated_by,updated_at,request_key,request_payload) VALUES ('Preserve','done',1,8,'admin@example.test','2026-09-16','admin@example.test','2026-09-16','migration-task','{}');
""")
before = dict(zip([row[1] for row in db.execute('PRAGMA table_info(manual_tasks)')], db.execute('SELECT * FROM manual_tasks').fetchone()))
db.executescript((root / 'migrations/0060_task_student_links.sql').read_text())
after = dict(zip([row[1] for row in db.execute('PRAGMA table_info(manual_tasks)')], db.execute('SELECT * FROM manual_tasks').fetchone()))
assert after == {key: value for key, value in before.items() if key not in ['status','student_id']}
assert db.execute('SELECT * FROM task_students').fetchall() == [(1,1)]
db.execute('INSERT INTO task_students VALUES (1,2)')
db.commit()
for sql in ['DELETE FROM students WHERE id=1','DELETE FROM students WHERE id=2','INSERT INTO task_students VALUES (1,1)','INSERT INTO task_students VALUES (1,99)']:
    try: db.execute(sql)
    except sqlite3.IntegrityError: db.rollback()
    else: raise AssertionError(sql)
db.execute('DELETE FROM task_students WHERE student_id=1')
db.execute('DELETE FROM students WHERE id=1')
assert db.execute('SELECT * FROM task_students').fetchall() == [(1,2)]
db.execute('DELETE FROM manual_tasks WHERE id=1')
assert db.execute('SELECT * FROM task_students').fetchall() == []
assert not db.execute('PRAGMA foreign_key_check').fetchall()
print('PASS: task details and student links survive migration; many-to-many restrictions and cascading cleanup hold.')
