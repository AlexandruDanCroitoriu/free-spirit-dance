"""Verify attendance migration preserves history, old grants and ID high-water marks."""
import sqlite3
from pathlib import Path
root = Path(__file__).resolve().parents[1]
for populated in (False, True):
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    for migration in sorted((root / 'migrations').glob('*.sql')):
        if migration.name.startswith('0027'): break
        db.executescript(migration.read_text())
    db.executescript("""
    INSERT INTO students (first_name,last_name,email) VALUES ('Test','Student','test@example.test');
    INSERT INTO admin_profiles (email,name) VALUES ('admin@example.test','Test');
    INSERT INTO courses (name) VALUES ('Test');
    INSERT INTO student_course_entries (student_id,course_id,entries_granted,granted_by,granted_at,reason)
    VALUES (1,1,4,'admin@example.test','2026-09-09','Legacy'),(1,NULL,3,'admin@example.test','2026-09-09','Shared');
    INSERT INTO attendance (student_course_entry_id,course_id,attended_at,recorded_by)
    VALUES (1,1,'2026-09-09T18:00:00Z','admin@example.test'),(2,1,'2026-09-09T18:00:00Z','admin@example.test');
    UPDATE sqlite_sequence SET seq=100 WHERE name='attendance';
    """)
    if not populated: db.execute('DELETE FROM attendance')
    before=db.execute('SELECT id,course_id,attended_at,recorded_by FROM attendance ORDER BY id').fetchall()
    grants=db.execute('SELECT * FROM student_course_entries ORDER BY id').fetchall()
    db.executescript('BEGIN;\n'+(root/'migrations/0027_student_activity.sql').read_text()+'\nCOMMIT;')
    assert before==db.execute('SELECT id,course_id,attended_at,recorded_by FROM attendance ORDER BY id').fetchall()
    assert grants==db.execute('SELECT * FROM student_course_entries ORDER BY id').fetchall()
    assert not db.execute('SELECT * FROM student_payments').fetchall(), 'Do not invent payment history'
    assert db.execute("SELECT seq FROM sqlite_sequence WHERE name='attendance'").fetchone()[0]==100
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    db.executescript("""
    INSERT INTO student_payments (student_id,paid_on,amount_minor,recorded_by,recorded_at,request_key,request_payload)
    VALUES (1,'2026-09-09',20000,'admin@example.test','2026-09-09T18:00:00Z','preservation-payment','{}');
    INSERT INTO payment_course_allowances (payment_id,course_id,course_name,allowance) VALUES (1,1,'Test',4);
    INSERT INTO student_courses VALUES (1,1);
    """)
    retained = {name: db.execute(f'SELECT * FROM "{name}" ORDER BY 1').fetchall()
                for (name,) in db.execute("SELECT name FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name != 'student_course_entries'").fetchall()}
    db.executescript((root/'migrations/0028_remove_legacy_course_entries.sql').read_text())
    assert not db.execute("SELECT name FROM sqlite_schema WHERE name='student_course_entries'").fetchall()
    for name, rows in retained.items():
        assert rows == db.execute(f'SELECT * FROM "{name}" ORDER BY 1').fetchall(), name
    assert not db.execute('PRAGMA foreign_key_check').fetchall()

print('PASS: attendance migration preserves history; legacy removal preserves payments, allocations, assignments, balances and foreign keys.')
