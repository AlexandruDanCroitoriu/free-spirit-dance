"""Synthetic-only tests for migration target safety and imported Catalog baselines."""
import importlib.util
from contextlib import nullcontext
import sqlite3
import sys
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).with_name('migrate-databases.py')
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('migrate_databases', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

registry = [[{'name': 'local_database_copies'}], [{'id': 'working'}, {'id': 'copy2'}]]
def registry_sql(target, query):
    assert target == ('WORKING_DB', False)
    return [{'results': registry[0 if 'sqlite_master' in query else 1]}]
with patch.object(module, 'sql', side_effect=registry_sql):
    assert module.targets('local') == [('CATALOG_DB', False), ('WORKING_DB', False), ('COPY2_DB', False)]
    assert module.targets('all')[-1] == ('PRODUCTION_DB', True)
with patch.object(module, 'sql', return_value=[{'results': []}]):
    assert module.targets('local') == [('CATALOG_DB', False)]
assert '--local' in module.command(('CATALOG_DB', False), ['migrations', 'apply'])
assert '--remote' not in module.command(('CATALOG_DB', False), ['migrations', 'apply'])
assert '--remote' in module.command(('PRODUCTION_DB', True), ['migrations', 'apply'])
try:
    module.prepare_catalog(('PRODUCTION_DB', True))
    raise AssertionError('Remote baseline must be rejected')
except RuntimeError:
    pass

with sqlite3.connect(':memory:') as db:
    for migration in module.MIGRATIONS:
        db.executescript(migration.read_text())
    db.executescript('CREATE TABLE _fsd_catalog_import (source_sha256 TEXT, imported_at TEXT); DROP TRIGGER ensure_administrator_cash_payment_method;')
    def objects():
        return [dict(zip(('name', 'sql'), row)) for row in db.execute("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL")]
    assert module.catalog_baseline(objects()) == (module.MIGRATIONS[-1].name, True)
    db.executescript('ALTER TABLE students ADD COLUMN unexpected TEXT')
    assert module.catalog_baseline(objects()) is None, 'Never baseline an unrecognized table definition'
assert module.canonical("DEFAULT 'a b'") != module.canonical("DEFAULT 'ab'")

with patch.object(module.sys, 'argv', ['migrate-databases.py', 'all']), patch.object(module.sys.stdin, 'isatty', return_value=False), patch.object(module, 'sql', side_effect=registry_sql), patch.object(module, 'run') as run:
    try:
        module.main()
        raise AssertionError('Noninteractive production writes must be rejected')
    except RuntimeError:
        pass
    run.assert_not_called()
with patch.object(module.sys, 'argv', ['migrate-databases.py', 'all', '--list']), patch.object(module, 'sql', side_effect=registry_sql), patch.object(module, 'run') as run, patch.object(module, 'prepare_catalog') as repair, patch.object(module, 'production_session', return_value=nullcontext()):
    module.main()
    assert run.call_count == 4
    assert all(call.args[1] == ['migrations', 'list'] for call in run.call_args_list)
    repair.assert_not_called()
with patch.object(module.subprocess, 'run') as run:
    run.return_value.returncode = 0
    module.run(('WORKING_DB', False), ['migrations', 'apply'])
    assert run.call_args.kwargs['stdin'] == module.subprocess.DEVNULL

with sqlite3.connect(':memory:') as db:
    for migration in module.MIGRATIONS:
        if migration.name > '0051z':
            break
        db.executescript(migration.read_text())
    db.execute('DROP TRIGGER ensure_administrator_cash_payment_method')
    objects = [{'name': name, 'sql': statement} for name, statement in db.execute("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")]
    applied = {path.name for path in module.MIGRATIONS[:2]}
    plan = module.production_plan(objects, applied)
    assert 'UPDATE student_payments' not in plan
    assert 'DROP TABLE' not in plan
    db.execute('CREATE TABLE d1_migrations (name TEXT UNIQUE)')
    db.executemany('INSERT INTO d1_migrations VALUES (?)', [(name,) for name in applied])
    db.executescript(plan)
    applied = {row[0] for row in db.execute('SELECT name FROM d1_migrations')}
    assert module.production_plan(objects, applied) is None
    db.executescript(next(path.read_text() for path in module.MIGRATIONS if path.name == '0052_payment_transfer_filter_collectors.sql'))
    assert 'collector_emails' in {row[1] for row in db.execute('PRAGMA table_info(payment_transfer_filters)')}
    objects = [row for row in objects if row['name'] != 'attendance']
    try:
        module.production_plan(objects, set())
        raise AssertionError('Incomplete production schema must fail before writes')
    except RuntimeError:
        pass
print('PASS: explicit targets, local-only history repair, exact schema checks, read-only listing and production confirmation.')
