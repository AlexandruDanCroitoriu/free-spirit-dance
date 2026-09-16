"""FSD release inspection, private exports, and offline data-preservation rehearsal.

Never merges, pushes, deploys, applies remote SQL, repairs ledgers, or imports
historical workbooks. Only `snapshot` accesses Cloudflare, using a read-only export.
"""
import argparse
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import production_target

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_ID = '6de090fa-ec37-493a-9818-a142f35552ae'


class PreflightError(Exception):
    pass


def git(root, *args):
    result = subprocess.run(['git', *args], cwd=root, capture_output=True, text=True)
    if result.returncode:
        raise PreflightError('Git inspection failed: ' + ' '.join(args[:2]))
    return result.stdout.strip()


def project(root):
    try:
        package = json.loads((root / 'package.json').read_text())
    except (OSError, ValueError):
        raise PreflightError('Run against the Free Spirit Dance repository.') from None
    if package.get('name') != 'free-spirit-dance':
        raise PreflightError('This helper is only for Free Spirit Dance.')
    return package


def migration_files(root):
    files = sorted((root / 'migrations').glob('*.sql'))
    if not files:
        raise PreflightError('No migration files found.')
    return files


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inspect(root, base, dev, main):
    package = project(root)
    refs = {name: git(root, 'rev-parse', '--verify', name + '^{commit}')
            for name in dict.fromkeys(['HEAD', base, dev, main])}
    counts = git(root, 'rev-list', '--left-right', '--count', f'{dev}...{main}').split()
    return {
        'kind': 'local_inspection', 'branch': git(root, 'branch', '--show-current'),
        'refs': refs, 'dev_only_commits': int(counts[0]), 'main_only_commits': int(counts[1]),
        'working_tree': git(root, 'status', '--short'),
        'migration_changes_vs_base': git(root, 'diff', '--name-status', base, '--', 'migrations'),
        'migration_sha256': {p.name: sha256(p) for p in migration_files(root)},
        'commands': {key: value for key, value in package.get('scripts', {}).items()
                     if key in ('verify', 'verify:release', 'test:browser', 'build', 'deploy', 'db:migrate:production')},
        'limitations': ['Remote refs are cached; fetch before making merge decisions.',
                       'This is not deployment status, live migration state, or release approval.'],
    }


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def tables(db):
    return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
            if not row[0].startswith('sqlite_') and row[0] != '_cf_KV'}


def rows(db, table, columns):
    # Preserve duplicates and SQLite value types: Python otherwise treats 1 and
    # 1.0 as equal, which could conceal a storage-type change during a rebuild.
    return Counter(tuple((type(value).__name__, value) for value in row)
                   for row in db.execute(f'SELECT {",".join(map(quote, columns))} FROM {quote(table)}'))


def deny_external_io(action, arg1, arg2, _database, _trigger):
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and (arg2 or '').lower() in ('load_extension', 'writefile', 'readfile'):
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA and (arg1 or '').lower() in ('writable_schema', 'temp_store_directory', 'data_store_directory'):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def load_snapshot(path):
    if not path.is_file() or not path.stat().st_size:
        raise PreflightError('Snapshot is missing or empty.')
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA temp_store=MEMORY')
    try:
        with path.open('rb') as stream:
            is_sqlite = stream.read(16) == b'SQLite format 3\x00'
        if is_sqlite:
            # Refuse a potentially live WAL database: use a consistent SQLite
            # backup or D1 SQL export, never copy an open database with cp.
            if any(Path(str(path) + suffix).exists() for suffix in ('-wal', '-journal')):
                raise PreflightError('Snapshot has live sidecars; create a consistent SQLite backup first.')
            with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as source:
                source.backup(db)
        else:
            db.set_authorizer(deny_external_io)
            db.executescript(path.read_text())
        db.set_authorizer(deny_external_io)
        db.execute('PRAGMA foreign_keys=ON')
        check_integrity(db)
        return db
    except (sqlite3.Error, UnicodeError):
        db.close()
        raise PreflightError('Snapshot could not be loaded safely; no records were printed.') from None
    except Exception:
        db.close()
        raise


def check_integrity(db):
    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise PreflightError('Snapshot integrity check failed.')
    if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
        raise PreflightError('Snapshot has foreign-key violations; stop for review.')


def rehearse(root, snapshot):
    project(root)
    files = migration_files(root)
    contents = {p.name: p.read_bytes() for p in files}
    hashes = {name: hashlib.sha256(sql).hexdigest() for name, sql in contents.items()}
    input_hash = sha256(snapshot)
    db = load_snapshot(snapshot)
    try:
        if 'd1_migrations' not in tables(db):
            raise PreflightError('No migration ledger. A reviewed baseline is required; do not infer or repair it here.')
        applied = [row[0] for row in db.execute('SELECT name FROM d1_migrations ORDER BY name')]
        names = [p.name for p in files]
        if applied != names[:len(applied)]:
            raise PreflightError('Unknown, missing, duplicate, or out-of-order migrations; no rehearsal attempted.')
        before = {}
        for table in tables(db):
            columns = [row[1] for row in db.execute(f'PRAGMA table_info({quote(table)})')]
            before[table] = (columns, rows(db, table, columns))
        sequences = dict(db.execute('SELECT name,seq FROM sqlite_sequence')) if db.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone() else {}
        pending = files[len(applied):]
        for path in pending:
            sql = contents[path.name].decode('utf-8')
            # D1 cannot disable FK enforcement. Reject legacy pragmas rather than
            # obtaining a misleading SQLite-only pass.
            def migration_authorizer(action, arg1, arg2, database, trigger):
                if action == sqlite3.SQLITE_PRAGMA and (arg1 or '').lower() in ('foreign_keys', 'ignore_check_constraints'):
                    return sqlite3.SQLITE_DENY
                return deny_external_io(action, arg1, arg2, database, trigger)
            db.set_authorizer(migration_authorizer)
            try:
                db.executescript(sql)
                db.execute('INSERT INTO d1_migrations (name) VALUES (?)', (path.name,))
                db.commit()
            except sqlite3.Error:
                raise PreflightError(f'Local rehearsal failed at {path.name}; no source or production data was changed.') from None
        added_columns = {}
        after_tables = tables(db)
        for table, (columns, original) in before.items():
            if table not in after_tables:
                raise PreflightError(f'Migration removes existing table {table}; stop for a data-preservation decision.')
            new_columns = [row[1] for row in db.execute(f'PRAGMA table_info({quote(table)})')]
            if not set(columns).issubset(new_columns):
                raise PreflightError(f'Migration removes existing columns in {table}; stop for review.')
            current = rows(db, table, columns)
            if table == 'd1_migrations':
                # New ledger records are expected, but old ledger rows must stay.
                if original - current or sum(current.values()) != sum(original.values()) + len(pending):
                    raise PreflightError('Existing migration ledger rows changed.')
            elif current != original:
                raise PreflightError(f'Existing records changed in {table}; stop for a data-preservation decision.')
            if set(new_columns) != set(columns):
                added_columns[table] = [c for c in new_columns if c not in columns]
        for table, seq in sequences.items():
            row = db.execute('SELECT seq FROM sqlite_sequence WHERE name=?', (table,)).fetchone()
            if row is None or row[0] < seq:
                raise PreflightError(f'ID sequence regressed for {table}.')
        check_integrity(db)
        if sha256(snapshot) != input_hash:
            raise PreflightError('Snapshot file changed during rehearsal; retry with a stable copy.')
        if {p.name: sha256(p) for p in migration_files(root)} != hashes:
            raise PreflightError('Migration files changed during rehearsal; retry with the final candidate.')
        return {
            'kind': 'offline_migration_rehearsal', 'checked_at_utc': datetime.now(timezone.utc).isoformat(),
            'snapshot_sha256': input_hash, 'migration_sha256': hashes,
            'applied_before': applied, 'pending': [p.name for p in pending],
            'existing_records_preserved': True, 'existing_tables_checked': len(before),
            'added_columns': added_columns, 'new_tables': sorted(after_tables - before.keys()),
            'integrity_check': 'ok', 'foreign_key_check': 'ok',
            'limitations': ['Offline SQLite rehearsal, not a live D1 execution test.',
                           'Does not verify R2 objects, old-app compatibility, runtime behavior, or deployment.',
                           'Re-export/rehearse if production schema or migration files change before release.'],
        }
    finally:
        db.close()


def snapshot_production(root, directory):
    project(root)
    directory = directory.expanduser().resolve()
    if directory.is_relative_to(root.resolve()):
        raise PreflightError('Production exports must be outside the repository.')
    config = json.loads((root / 'wrangler.local.json').read_text())
    binding = next((b for b in config.get('d1_databases', []) if b.get('binding') == 'PRODUCTION_DB'), {})
    if binding.get('database_id') != PRODUCTION_ID or binding.get('remote') is not True:
        raise PreflightError('Unexpected production binding. Stop and review the target.')
    target = production_target.resolve(root)
    directory.mkdir(parents=True, exist_ok=True)
    private = Path(tempfile.mkdtemp(prefix='fsd-release-', dir=directory))
    output, log = private / 'production.sql', private / 'export.log'
    command = [str(root / 'node_modules/.bin/wrangler'), 'd1', 'export', 'PRODUCTION_DB',
               '--remote', '--config', str(root / 'wrangler.local.json'), '--output', str(output)]
    previous_umask = os.umask(0o077)
    try:
        with production_target.configuration(root, target) as target_config, log.open('x') as stream:
            command[command.index('--config') + 1] = str(target_config)
            production_target.verify(root, target)
            result = subprocess.run(command, cwd=root, stdin=subprocess.DEVNULL,
                stdout=stream, stderr=subprocess.STDOUT,
                env={**os.environ, 'WRANGLER_LOG_PATH': str(private / 'wrangler-logs'), 'WRANGLER_SEND_METRICS': 'false'})
    finally:
        os.umask(previous_umask)
    # Wrangler prints a signed download URL. Keep its entire output private.
    if result.returncode or not output.exists() or not output.stat().st_size:
        raise PreflightError(f'Export failed. Inspect the private log locally: {log}. No migration was attempted.')
    output.chmod(0o600)
    production_target.verify(root, target)
    (private / 'target.json').write_text(json.dumps(target, indent=2))
    (private / 'target.json').chmod(0o600)
    return {'kind': 'production_export', 'directory': str(private), 'snapshot': str(output),
            'snapshot_sha256': sha256(output), 'database_id': target['database_id'], 'active_target': target,
            'exported_at_utc': datetime.now(timezone.utc).isoformat()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=ROOT)
    sub = parser.add_subparsers(dest='action', required=True)
    status = sub.add_parser('inspect', help='Inspect local Git refs and release commands; no network access.')
    status.add_argument('--base', default='origin/main')
    status.add_argument('--dev', default='dev')
    status.add_argument('--main', default='main')
    rehearsal = sub.add_parser('rehearse', help='Apply pending migrations in memory and compare every existing record.')
    rehearsal.add_argument('--snapshot', required=True, type=Path)
    export = sub.add_parser('snapshot', help='Export private production data read-only; requires user authorization.')
    export.add_argument('--directory', type=Path, required=True, help='Private parent directory outside Git.')
    args = parser.parse_args()
    root = args.repo.resolve()
    if args.action == 'inspect':
        report = inspect(root, args.base, args.dev, args.main)
    elif args.action == 'rehearse':
        report = rehearse(root, args.snapshot.resolve())
    else:
        report = snapshot_production(root, args.directory)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (PreflightError, OSError, ValueError, RuntimeError) as error:
        print(f'BLOCKED: {error}', file=sys.stderr)
        sys.exit(1)
    except sqlite3.Error:
        print('BLOCKED: Snapshot schema or migration validation failed; no record contents were printed.', file=sys.stderr)
        sys.exit(1)
