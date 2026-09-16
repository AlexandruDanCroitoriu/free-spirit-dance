"""Consolidate shared boards without losing cards, then enforce private ownership."""
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
for path in sorted((root / 'migrations').glob('*.sql')):
    if path.name.startswith('0059'): break
    db.executescript(path.read_text())
db.executescript("""
PRAGMA foreign_keys=ON;
INSERT INTO admin_profiles(email,name) VALUES ('admin@example.test','Admin');
INSERT INTO task_boards(id,name) VALUES (2,'Events');
INSERT INTO task_lists(id,board_id,name,sort_order) VALUES (4,2,'Invitations',0),(5,2,'Venue',1);
INSERT INTO manual_tasks(request_key,request_payload,sort_order,title,list_id,created_by,created_at,updated_by,updated_at) VALUES ('preserve-card','{}',0,'Preserved',4,'admin@example.test','2026-09-16','admin@example.test','2026-09-16');
INSERT INTO manual_tasks(request_key,request_payload,sort_order,title,list_id,inbox_owner,created_by,created_at,updated_by,updated_at) VALUES ('private-card','{}',0,'Private',NULL,'admin@example.test','admin@example.test','2026-09-16','admin@example.test','2026-09-16');
""")
cards = db.execute('SELECT * FROM manual_tasks').fetchall()
lists = db.execute('SELECT id,name FROM task_lists ORDER BY board_id,sort_order,id').fetchall()
db.executescript((root / 'migrations/0059_personal_task_boards.sql').read_text())
assert db.execute('SELECT * FROM manual_tasks').fetchall() == cards
assert db.execute('SELECT id,name FROM task_lists ORDER BY sort_order,id').fetchall() == lists
assert db.execute('SELECT id,name,owner_email FROM task_boards').fetchall() == [(1,'School',None)]
assert db.execute('SELECT DISTINCT board_id FROM task_lists').fetchall() == [(1,)]
db.execute("INSERT INTO task_boards(name,owner_email) VALUES ('Personal','admin@example.test')")
db.commit()
for sql in ["INSERT INTO task_boards(name) VALUES ('Second school')", "INSERT INTO task_boards(name,owner_email) VALUES ('Duplicate','ADMIN@example.test')", "INSERT INTO task_boards(name,owner_email) VALUES ('Unknown','unknown@example.test')", "UPDATE task_boards SET owner_email=NULL WHERE owner_email IS NOT NULL", "UPDATE task_lists SET board_id=2 WHERE id=4"]:
    try: db.execute(sql)
    except sqlite3.IntegrityError: db.rollback()
    else: raise AssertionError(sql)
assert not db.execute('PRAGMA foreign_key_check').fetchall()
print('PASS: School consolidation preserves cards, Inbox and list order; private board constraints hold.')
