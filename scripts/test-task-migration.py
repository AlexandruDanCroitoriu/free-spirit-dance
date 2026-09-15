"""Upgrade a synthetic pre-task database without touching any persisted store."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
for path in sorted((root / 'migrations').glob('*.sql')):
    if path.name >= '0055_manual_tasks.sql':
        break
    db.executescript(path.read_text())
db.execute('PRAGMA foreign_keys=ON')
db.executescript("""
INSERT INTO students (first_name,last_name,email,phone,picture,active,birth_date,facebook_url,instagram_url)
VALUES ('Existing','Student','','0712345678','/api/student-images/student-existing',0,'1990-02-28','','');
INSERT INTO admin_profiles (email,name) VALUES ('admin@example.test','Administrator');
INSERT INTO administrator_permissions (email,can_students) VALUES ('admin@example.test',1);
""")
before = db.execute('SELECT * FROM students').fetchall()
db.executescript((root / 'migrations/0055_manual_tasks.sql').read_text())
assert db.execute('SELECT * FROM students').fetchall() == before
assert db.execute('SELECT can_students,can_tasks FROM administrator_permissions').fetchone() == (1, 0)
assert db.execute('SELECT id,revision FROM task_board_state').fetchone() == (1, 0)
assert db.execute('SELECT COUNT(*) FROM manual_tasks').fetchone()[0] == 0

db.execute("""INSERT INTO manual_tasks
(title,student_id,sort_order,created_by,created_at,updated_by,updated_at,request_key,request_payload)
VALUES ('Existing link',1,0,'admin@example.test','2026-09-15','admin@example.test','2026-09-15','migration-test-key','{}')""")
db.commit()
for status in ('todo', 'in_progress', 'done'):
    db.execute('UPDATE manual_tasks SET status=?', (status,))
    db.commit()
    try:
        db.execute('DELETE FROM students WHERE id=1')
        raise AssertionError('Linked student deletion must fail in every status')
    except sqlite3.IntegrityError:
        db.rollback()
for column, value in [('status','unknown'), ('title',''), ('sort_order',-1), ('due_date','2026-02-30'), ('due_date','invalid')]:
    try:
        db.execute(f'UPDATE manual_tasks SET {column}=?', (value,))
        raise AssertionError(f'Invalid {column} accepted')
    except sqlite3.IntegrityError:
        db.rollback()
revision = db.execute('SELECT revision FROM task_board_state').fetchone()[0]
try:
    db.execute('UPDATE task_board_state SET revision=?', (revision,))
    raise AssertionError('Stale revision accepted')
except sqlite3.IntegrityError:
    db.rollback()
db.execute('UPDATE manual_tasks SET student_id=NULL')
db.execute('DELETE FROM students WHERE id=1')
assert db.execute('SELECT COUNT(*) FROM manual_tasks').fetchone()[0] == 1
assert not db.execute('PRAGMA foreign_key_check').fetchall()
db.close()
print('PASS: manual-task upgrade preserves profiles and permissions, enforces constraints and blocks linked student deletion.')
