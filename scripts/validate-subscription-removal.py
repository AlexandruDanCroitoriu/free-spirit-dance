"""Check removal preserves grants, attendance, unrelated records and ID sequences."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for migration in sorted((root / 'migrations').glob('*.sql')):
    if migration.name.startswith('0025'): break
    db.executescript(migration.read_text())
db.executescript("""
INSERT INTO students (first_name,last_name,email) VALUES ('Test','Student','test@example.test');
INSERT INTO admin_profiles (email,name) VALUES ('admin@example.test','Test');
INSERT INTO courses (name) VALUES ('Test');
INSERT INTO subscription (name) VALUES ('Test');
INSERT INTO student_subscriptions (student_id,subscription_id,starts_on) VALUES (1,1,'2026-09-09');
INSERT INTO subscription_courses VALUES (1,1,4);
INSERT INTO subscription_payments (student_subscription_id,paid_at,amount_minor) VALUES (1,'2026-09-09',1000);
INSERT INTO student_course_entries (student_id,course_id,student_subscription_id,entries_granted,granted_by,granted_at,reason)
VALUES (1,1,1,4,'admin@example.test','2026-09-09','Existing'),
       (1,NULL,1,3,'admin@example.test','2026-09-09','Shared'),
       (1,1,NULL,2,'admin@example.test','2026-09-09','Free');
INSERT INTO attendance (student_course_entry_id,course_id,attended_at,recorded_by)
VALUES (1,1,'2026-09-09','admin@example.test'),(2,1,'2026-09-09','admin@example.test');
UPDATE sqlite_sequence SET seq = 50 WHERE name IN ('attendance','student_course_entries');
""")
retained = {}
for (name,) in db.execute("SELECT name FROM sqlite_schema WHERE type='table'").fetchall():
    if 'subscription' in name or name.startswith('sqlite_'): continue
    columns = ','.join(row[1] for row in db.execute(f'PRAGMA table_info({name})') if row[1] != 'student_subscription_id')
    retained[name] = (columns, db.execute(f'SELECT {columns} FROM {name} ORDER BY 1').fetchall())
db.executescript('BEGIN;\n' + (root / 'migrations/0025_remove_subscriptions.sql').read_text() + '\nCOMMIT;')
for name, (columns, rows) in retained.items():
    assert rows == db.execute(f'SELECT {columns} FROM {name} ORDER BY 1').fetchall(), name
assert not db.execute("SELECT name FROM sqlite_schema WHERE lower(sql) LIKE '%subscription%'").fetchall()
assert not db.execute('PRAGMA foreign_key_check').fetchall()
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert dict(db.execute("SELECT name,seq FROM sqlite_sequence WHERE name IN ('attendance','student_course_entries')")) == {'attendance':50,'student_course_entries':50}
print('PASS: removal preserves existing grants, attendance, unrelated records, constraints and ID sequences.')
