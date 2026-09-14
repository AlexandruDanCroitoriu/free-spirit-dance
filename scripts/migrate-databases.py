"""Migrate explicit app targets; never import or copy student records."""
import argparse
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'wrangler.local.json'
MIGRATIONS = sorted((ROOT / 'migrations').glob('*.sql'))


def targets(scope):
    bindings = json.loads(CONFIG.read_text())['d1_databases']
    names = {'catalog': ['CATALOG_DB'], 'copies': ['WORKING_DB', *[f'COPY{i}_DB' for i in range(2, 9)]], 'production': ['PRODUCTION_DB']}
    names['local'] = names['catalog'] + names['copies']
    names['all'] = names['local'] + names['production']
    result = []
    for name in names[scope]:
        binding = next(item for item in bindings if item['binding'] == name)
        remote = name == 'PRODUCTION_DB'
        expected = '5c15ead5-18f8-49ec-a634-d89d2fd00daa' if remote else ('00000000-0000-0000-0000-' + f"{2 if name == 'CATALOG_DB' else 3 if name == 'WORKING_DB' else int(name[4:-3]) + 3:012d}")
        if binding.get('remote') is not remote or binding['database_id'] != expected:
            raise RuntimeError(f'Unsafe or unexpected configuration for {name}.')
        result.append((name, remote))
    if scope in ('copies', 'local', 'all'):
        registry = ('WORKING_DB', False)
        exists = sql(registry, "SELECT name FROM sqlite_master WHERE type='table' AND name='local_database_copies'")[0]['results']
        rows = sql(registry, 'SELECT id FROM local_database_copies WHERE ready=1 ORDER BY created_at,id')[0]['results'] if exists else []
        slots = {'working': 'WORKING_DB', **{f'copy{i}': f'COPY{i}_DB' for i in range(2, 9)}}
        if any(row['id'] not in slots for row in rows):
            raise RuntimeError('Unrecognized saved copy in local registry; refusing to guess targets.')
        saved = {slots[row['id']] for row in rows}
        result = [target for target in result if target[0] in ('CATALOG_DB', 'PRODUCTION_DB') or target[0] in saved]
    return result


def command(target, operation, *args):
    name, remote = target
    return [str(ROOT / 'node_modules/.bin/wrangler'), 'd1', *operation, name,
            '--remote' if remote else '--local', '--config', str(CONFIG), *args]


def run(target, operation, *args, capture=False):
    logs = ROOT / '.wrangler/migration-logs'
    logs.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(command(target, operation, *args), cwd=ROOT,
        env={**os.environ, 'WRANGLER_LOG_PATH': str(logs), 'WRANGLER_SEND_METRICS': 'false'},
        stdin=subprocess.DEVNULL, capture_output=capture, text=True)
    if result.returncode:
        raise RuntimeError(f'{target[0]} failed. Stopped before subsequent databases; see .wrangler/migration-logs. Earlier successful migrations remain applied.')
    return json.loads(result.stdout) if capture else None


def sql(target, query):
    return run(target, ['execute'], '--command', query, '--json', capture=True)


def canonical(statement):
    # Ignore formatting/identifier quoting, but retain whitespace inside literals.
    tokens = re.findall(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|\w+|[^\s]", statement)
    return tuple(token[1:-1] if token.startswith('"') else token for token in tokens)


def production_plan(objects, applied):
    """Recognize the inspected pre-0052 application schema, not historical data."""
    baseline = '0051_payment_transfer_filter_order.sql'
    known = [path.name for path in MIGRATIONS]
    present = [name in applied for name in known]
    gap = next((i for i, value in enumerate(present) if not value), len(present))
    # Current databases use Wrangler normally. Old ledgers require a full check.
    if gap >= known.index(baseline) + 1 and not any(present[gap:]):
        return None
    actual = {row['name']: row['sql'] for row in objects if row['sql']}
    with sqlite3.connect(':memory:') as reference:
        for path in MIGRATIONS:
            if path.name > baseline:
                break
            reference.executescript(path.read_text())
        expected = dict(reference.execute("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"))
    mismatches = []
    trigger = 'ensure_administrator_cash_payment_method'
    for name, statement in expected.items():
        found = actual.get(name, '')
        if name == trigger and not found:
            continue
        if name == 'payment_transfer_filters':
            found = found.replace("payment_kind TEXT NOT NULL DEFAULT 'course'", 'payment_kind TEXT NOT NULL')
        if canonical(statement) != canonical(found):
            mismatches.append(name)
    if mismatches or any(name > baseline for name in applied if name in known):
        raise RuntimeError('Production migration history does not match its schema. No migrations applied. Schema review required: ' + ', '.join(mismatches or ['out-of-order migration ledger']))
    statements = []
    if trigger not in actual:
        # Restore future defaults only; do not rewrite existing payment methods.
        statements.append(expected[trigger] + ';')
    statements.extend([
        'CREATE TABLE IF NOT EXISTS fsd_schema_baselines (version TEXT PRIMARY KEY, recorded_at TEXT NOT NULL, reason TEXT NOT NULL);',
        f"INSERT INTO fsd_schema_baselines VALUES ('{baseline}', datetime('now'), 'Verified existing application schema; historical data migrations were not replayed');",
    ])
    statements.extend(f"INSERT INTO d1_migrations (name) VALUES ('{name}');" for name in known if name <= baseline and name not in applied)
    return '\n'.join(statements)


def inspect_production():
    target = ('PRODUCTION_DB', True)
    objects = sql(target, "SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")[0]['results']
    if not any(row['name'] == 'd1_migrations' for row in objects):
        raise RuntimeError('Production has no migration ledger; refusing automatic migration. Schema review required.')
    applied = {row['name'] for row in sql(target, 'SELECT name FROM d1_migrations')[0]['results']}
    return production_plan(objects, applied)


def repair_production(plan):
    # Called only after the single interactive production confirmation.
    target = ('PRODUCTION_DB', True)
    directory = ROOT / '.wrangler/migration-backups'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = directory / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-production.sql')
    previous_umask = os.umask(0o077)
    try:
        run(target, ['export'], '--output', str(backup))
    finally:
        os.umask(previous_umask)
    if not backup.exists() or backup.stat().st_size == 0:
        raise RuntimeError('Production backup is missing or empty; no schema repair performed.')
    print(f'Private production backup: {backup}', flush=True)
    # Recheck after the backup, before changing the ledger.
    if inspect_production() != plan:
        raise RuntimeError('Production schema changed during preflight. Nothing repaired; retry inspection.')
    with tempfile.TemporaryDirectory(prefix='fsd-app-schema-baseline-') as directory:
        path = Path(directory) / 'baseline.sql'
        path.write_text(plan)
        path.chmod(0o600)
        run(target, ['execute'], '--file', str(path), '--json', capture=True)


def catalog_baseline(actual):
    """Only accept a complete known imported schema, never infer from one column."""
    actual = {row['name']: row['sql'] for row in actual if row['sql']}
    if '_fsd_catalog_import' not in actual:
        return None
    cash_trigger = 'ensure_administrator_cash_payment_method'
    match = None
    with sqlite3.connect(':memory:') as reference:
        for migration in MIGRATIONS:
            reference.executescript(migration.read_text())
            if migration.name < '0047':
                continue
            objects = dict(reference.execute("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"))
            # The historical seed deliberately omitted this cash-default trigger.
            missing_cash = cash_trigger not in actual
            if all((name == cash_trigger and missing_cash) or canonical(statement) == canonical(actual.get(name, '')) for name, statement in objects.items()):
                match = (migration.name, missing_cash)
    return match


def prepare_catalog(target):
    if target != ('CATALOG_DB', False):
        raise RuntimeError('Imported-schema baselining is permitted only for local Catalog.')
    objects = sql(target, "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")[0]['results']
    names = {row['name'] for row in objects}
    if '_fsd_catalog_import' not in names:
        return
    applied = {row['name'] for row in sql(target, 'SELECT name FROM d1_migrations')[0]['results']} if 'd1_migrations' in names else set()
    # Normal, contiguous history needs no repair.
    present = [path.name in applied for path in MIGRATIONS]
    first_gap = next((i for i, value in enumerate(present) if not value), len(present))
    if first_gap >= 46 and not any(present[first_gap:]):
        return
    baseline = catalog_baseline(objects)
    if not baseline:
        raise RuntimeError('Catalog has incomplete migration history and an unrecognized schema. No history was changed; inspect this local imported database before migrating.')
    through, missing_cash = baseline
    print(f'Catalog: verified imported schema through {through}; recording a baseline without replaying historical migrations.', flush=True)
    statements = []
    if missing_cash:
        statements.append((ROOT / 'migrations/0047_cash_payment_method.sql').read_text())
    statements.append('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);')
    for migration in MIGRATIONS:
        if migration.name <= through and migration.name not in applied:
            statements.append(f"INSERT INTO d1_migrations (name) VALUES ('{migration.name}');")
    with tempfile.TemporaryDirectory(prefix='fsd-catalog-baseline-') as directory:
        path = Path(directory) / 'baseline.sql'
        path.write_text('\n'.join(statements))
        path.chmod(0o600)
        run(target, ['execute'], '--file', str(path), '--json', capture=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scope', choices=['catalog', 'copies', 'local', 'production', 'all'], nargs='?', default='local')
    parser.add_argument('--list', action='store_true', help='List pending migrations only; do not repair history or apply anything.')
    args = parser.parse_args()
    selected = targets(args.scope)
    plan = None
    if any(remote for _, remote in selected) and not args.list:
        if not sys.stdin.isatty():
            raise RuntimeError('Production requires an interactive terminal. Run this command yourself and confirm the production target.')
        plan = inspect_production()
        if plan:
            print('Production needs a verified application-schema baseline through 0051. A private backup will be saved; old data migrations will NOT be replayed.')
        print('This will apply app migrations to the LIVE production database FS-Dance. Review pending migrations and a private backup first.')
        if input('Type MIGRATE PRODUCTION to continue: ') != 'MIGRATE PRODUCTION':
            raise RuntimeError('Cancelled; no databases were changed.')
    for target in selected:
        print(f"\n{target[0]} ({'LIVE production' if target[1] else 'local only'})", flush=True)
        if target[0] == 'CATALOG_DB' and not args.list:
            prepare_catalog(target)
        if target[1] and plan and not args.list:
            repair_production(plan)
        run(target, ['migrations', 'list' if args.list else 'apply'])
    print('\nMigration check complete.' if args.list else '\nAll selected databases are up to date.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, EOFError, KeyboardInterrupt) as error:
        print(str(error) or 'Cancelled.', file=sys.stderr)
        sys.exit(1)
