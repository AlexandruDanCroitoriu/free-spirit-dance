"""Synthetic release rehearsal tests. Never access Cloudflare or local Catalog."""
import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('release_preflight', Path(__file__).with_name('release-preflight.py'))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleasePreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        (self.root / 'package.json').write_text('{"name":"free-spirit-dance"}')
        (self.root / 'migrations').mkdir()
        self.initial = '''CREATE TABLE students(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, picture BLOB);
CREATE TABLE visits(student_id INTEGER REFERENCES students(id), note TEXT);
'''
        self.migration('0001_initial.sql', self.initial)
        self.snapshot = Path(self.temp.name) / 'snapshot.sql'
        self.snapshot.write_text(self.initial + '''
CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO d1_migrations(name) VALUES ('0001_initial.sql');
INSERT INTO students VALUES (9,'Synthetic student',X'0001FF');
INSERT INTO visits VALUES (9,NULL),(9,NULL);
''')
        self.original = self.snapshot.read_bytes()

    def tearDown(self):
        self.assertEqual(self.snapshot.read_bytes(), self.original)
        self.temp.cleanup()

    def migration(self, name, sql):
        (self.root / 'migrations' / name).write_text(sql)

    def run_rehearsal(self):
        return release.rehearse(self.root, self.snapshot)

    def test_additive_upgrade_preserves_null_blob_duplicates_and_ids(self):
        self.migration('0002_tasks.sql', 'ALTER TABLE students ADD COLUMN active INTEGER DEFAULT 1; CREATE TABLE tasks(id INTEGER PRIMARY KEY);')
        report = self.run_rehearsal()
        self.assertTrue(report['existing_records_preserved'])
        self.assertEqual(report['pending'], ['0002_tasks.sql'])
        self.assertEqual(report['added_columns'], {'students': ['active']})
        self.assertEqual(report['new_tables'], ['tasks'])
        self.assertNotIn('Synthetic student', json.dumps(report))

    def test_current_snapshot_no_pending_migrations(self):
        self.assertEqual(self.run_rehearsal()['pending'], [])

    def test_row_comparison_distinguishes_numeric_storage_types(self):
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute('CREATE TABLE sample(value)')
            db.execute('INSERT INTO sample VALUES(1)')
            original = release.rows(db, 'sample', ['value'])
            db.execute('UPDATE sample SET value=1.0')
            self.assertNotEqual(original, release.rows(db, 'sample', ['value']))

    def test_changes_and_deletions_block(self):
        for sql in ["UPDATE students SET name='Changed';", 'DELETE FROM visits WHERE rowid=1;',
                    'INSERT INTO visits VALUES(9,NULL);', 'DROP TABLE visits;',
                    'ALTER TABLE students DROP COLUMN picture;',
                    "UPDATE sqlite_sequence SET seq=0 WHERE name='students';"]:
            with self.subTest(sql=sql):
                self.migration('0002_change.sql', sql)
                with self.assertRaises(release.PreflightError):
                    self.run_rehearsal()

    def test_ledger_gaps_and_unknown_versions_block(self):
        original = self.snapshot.read_text()
        for old in ['0000_unknown.sql', '0002_later.sql']:
            with self.subTest(old=old):
                self.snapshot.write_text(original.replace("VALUES ('0001_initial.sql')", f"VALUES ('{old}')"))
                with self.assertRaisesRegex(release.PreflightError, 'Unknown'):
                    self.run_rehearsal()
        self.snapshot.write_bytes(self.original)

    def test_missing_ledger_blocks(self):
        self.snapshot.write_text(self.initial)
        try:
            with self.assertRaisesRegex(release.PreflightError, 'No migration ledger'):
                self.run_rehearsal()
        finally:
            self.snapshot.write_bytes(self.original)

    def test_foreign_key_failures_and_disabling_constraints_block(self):
        for sql in ['INSERT INTO visits VALUES(123,NULL);', 'PRAGMA foreign_keys=OFF;', 'PRAGMA ignore_check_constraints=ON;']:
            with self.subTest(sql=sql):
                self.migration('0002_bad.sql', sql)
                with self.assertRaises(release.PreflightError):
                    self.run_rehearsal()

    def test_no_external_sql_file_access(self):
        target = Path(self.temp.name) / 'unexpected.sqlite'
        self.migration('0002_attach.sql', f"ATTACH DATABASE '{target}' AS other;")
        with self.assertRaises(release.PreflightError):
            self.run_rehearsal()
        self.assertFalse(target.exists())

    def test_sqlite_snapshot_read_only_and_live_sidecar_rejected(self):
        path = Path(self.temp.name) / 'snapshot.sqlite'
        with closing(sqlite3.connect(path)) as db:
            db.executescript(self.snapshot.read_text())
        original = path.read_bytes()
        self.assertTrue(release.rehearse(self.root, path)['existing_records_preserved'])
        self.assertEqual(path.read_bytes(), original)
        Path(str(path) + '-wal').write_bytes(b'pending')
        with self.assertRaisesRegex(release.PreflightError, 'sidecars'):
            release.rehearse(self.root, path)

    @patch.object(release.production_target, 'resolve', return_value={'active':'production','generation':1,'database_id':release.PRODUCTION_ID,'database_name':'original'})
    @patch.object(release.production_target, 'verify')
    def test_snapshot_target_and_export_privacy(self, _verify, _resolve):
        config = {'d1_databases': [{'binding': 'PRODUCTION_DB', 'database_id': release.PRODUCTION_ID, 'remote': True}]}
        (self.root / 'wrangler.local.json').write_text(json.dumps(config))
        with self.assertRaisesRegex(release.PreflightError, 'outside'):
            release.snapshot_production(self.root, self.root / 'private')
        def export(command, **kwargs):
            self.assertEqual(command[1:5], ['d1', 'export', 'PRODUCTION_DB', '--remote'])
            self.assertNotIn('execute', command)
            Path(command[-1]).write_bytes(self.original)
            kwargs['stdout'].write('private signed export URL')
            return type('Result', (), {'returncode': 0})()
        with patch.object(release.subprocess, 'run', side_effect=export):
            report = release.snapshot_production(self.root, Path(self.temp.name) / 'backups')
        directory = Path(report['directory'])
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(Path(report['snapshot']).stat().st_mode & 0o777, 0o600)
        self.assertEqual((directory / 'export.log').stat().st_mode & 0o777, 0o600)
        self.assertNotIn('private signed', json.dumps(report))
        config['d1_databases'][0]['database_id'] = 'wrong'
        (self.root / 'wrangler.local.json').write_text(json.dumps(config))
        with self.assertRaisesRegex(release.PreflightError, 'Unexpected'):
            release.snapshot_production(self.root, Path(self.temp.name))

    def test_real_task_upgrade_with_synthetic_pre_task_records(self):
        repo = Path(__file__).resolve().parents[1]
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)')
        for path in sorted((repo / 'migrations').glob('*.sql')):
            if path.name >= '0054':
                break
            db.executescript(path.read_text())
            db.execute('INSERT INTO d1_migrations(name) VALUES(?)', (path.name,))
            db.commit()
        db.execute("INSERT INTO students(first_name,last_name,email,picture) VALUES('Synthetic','Student','student@example.test','private-image-key')")
        db.execute("INSERT INTO admin_profiles(email,name) VALUES('admin@example.test','Synthetic Admin')")
        db.executescript("""
INSERT INTO administrator_permissions(email,can_students) VALUES('admin@example.test',1);
INSERT INTO courses(name) VALUES('Synthetic course');
INSERT INTO course_schedule(course_id,day_of_week,start_time,end_time) VALUES(1,'Monday','18:00','19:00');
INSERT INTO student_courses(student_id,course_id) VALUES(1,1);
INSERT INTO classes(course_id,class_date,start_time) VALUES(1,'2026-09-07','18:00');
INSERT INTO attendance(student_id,course_id,course_name,attended_at,recorded_by,class_id)
VALUES(1,1,'Synthetic course','2026-09-07T18:00:00','admin@example.test',1);
INSERT INTO student_payments(student_id,paid_on,amount_minor,recorded_by,recorded_at,request_key,request_payload)
VALUES(1,'2026-09-07',12345,'admin@example.test','2026-09-07T18:00:00Z','synthetic-release-payment','{}');
INSERT INTO payment_course_allowances(payment_id,course_id,course_name,allowance) VALUES(1,1,'Synthetic course',4);
INSERT INTO payment_presets(name,amount_minor,course_id) VALUES('Synthetic preset',12345,1);
INSERT INTO payment_preset_courses(preset_id,course_id,allowance) VALUES(1,1,4);
""")
        # Represent source-provenance tables too: never invoke historical imports.
        db.execute('CREATE TABLE history_notes(id INTEGER PRIMARY KEY, note TEXT)')
        db.execute("INSERT INTO history_notes VALUES(1,'synthetic provenance')")
        fixture = Path(self.temp.name) / 'pre-task.sql'
        fixture.write_text('\n'.join(db.iterdump()))
        db.close()
        report = release.rehearse(repo, fixture)
        self.assertEqual(report['pending'][0], '0054_zero_value_payment_presets.sql')
        self.assertTrue(report['existing_records_preserved'])
        self.assertIn('can_tasks', report['added_columns']['administrator_permissions'])


if __name__ == '__main__':
    unittest.main()
