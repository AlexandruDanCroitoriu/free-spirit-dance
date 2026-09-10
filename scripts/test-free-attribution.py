import sqlite3
from pathlib import Path

db = sqlite3.connect(':memory:')
db.execute('CREATE TABLE attendance (id INTEGER PRIMARY KEY, notes TEXT, complimentary INTEGER, recorded_by TEXT, recorded_at TEXT)')
old = 'Trial class\nComplimentary granted by first@test at 2026-09-10T10:00:00.000Z\nComplimentary removed by second@test at 2026-09-10T11:00:00.000Z\nComplimentary granted by last@test at 2026-09-10T12:00:00.000Z: Trial'
db.executemany('INSERT INTO attendance VALUES (?,?,?,?,?)', [(1,old,1,'original@test','2026-09-01T10:00:00.000Z'),(2,old,0,'original@test',None),(3,'Reason',1,'original@test','2026-09-01T10:00:00.000Z')])
db.executescript(Path('migrations/0035_free_attendance_attribution.sql').read_text())
assert db.execute('SELECT notes,complimentary_by,complimentary_at FROM attendance WHERE id=1').fetchone() == ('Trial class','last@test','2026-09-10T12:00:00.000Z')
assert db.execute('SELECT notes,complimentary_by,complimentary_at FROM attendance WHERE id=2').fetchone() == ('Trial class',None,None)
assert db.execute('SELECT notes,complimentary_by FROM attendance WHERE id=3').fetchone() == ('Reason','original@test')
print('PASS: latest grant attribution migrated, disabled attribution cleared, ordinary notes preserved.')
