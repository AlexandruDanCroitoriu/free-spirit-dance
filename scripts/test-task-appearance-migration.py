"""Appearance migration preserves task records, placement, ownership and links."""
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
for path in sorted((root / 'migrations').glob('*.sql')):
    if path.name.startswith('0061'): break
    db.executescript(path.read_text())
db.executescript("""
PRAGMA foreign_keys=ON;
INSERT INTO admin_profiles(email,name) VALUES ('admin@example.test','Admin');
INSERT INTO students(id,first_name,last_name,email) VALUES (1,'One','Student','');
INSERT INTO task_boards(name,owner_email) VALUES ('Personal','admin@example.test');
INSERT INTO task_lists(board_id,name,sort_order) VALUES (2,'Private list',7);
INSERT INTO manual_tasks(title,list_id,sort_order,created_by,created_at,updated_by,updated_at,request_key,request_payload) VALUES ('Preserve',2,8,'admin@example.test','2026-09-16','admin@example.test','2026-09-16','migration-task','{}');
INSERT INTO task_students VALUES (1,1);
""")
before = {name: db.execute(f'SELECT * FROM {name}').fetchall() for name in ['task_boards','task_lists','manual_tasks','task_students']}
db.executescript((root / 'migrations/0061_task_appearance.sql').read_text())
for name in before:
    rows = db.execute(f'SELECT * FROM {name}').fetchall()
    assert ([row[:-1] for row in rows] if name in ['task_boards','task_lists'] else rows) == before[name]
assert db.execute('SELECT color FROM task_lists').fetchall() == [('default',),('default',)]
db.execute("INSERT INTO task_preferences VALUES ('admin@example.test','ocean')")
db.commit()
for sql in ["UPDATE task_lists SET color='invalid'", "UPDATE task_boards SET color='invalid'", "UPDATE task_preferences SET inbox_color='invalid'", "INSERT INTO task_preferences VALUES ('unknown@example.test','blue')"]:
    try: db.execute(sql)
    except sqlite3.IntegrityError: db.rollback()
    else: raise AssertionError(sql)
assert not db.execute('PRAGMA foreign_key_check').fetchall()
print('PASS: appearance migration preserves tasks, ownership, links and positions; presets and owner references are constrained.')
