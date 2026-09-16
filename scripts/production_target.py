"""Resolve the deployed FSD database read-only; never assume original == active."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from contextlib import contextmanager

ORIGINAL_ID = '6de090fa-ec37-493a-9818-a142f35552ae'
BRIDGE_URL = 'https://free-spirit-dance.alexandru-croitoriu.dev/api/administrators/production-backups'


def bridge_status(root):
    # Node's dotenv parser keeps credential handling consistent with local tools.
    script = r'''
import { existsSync } from 'node:fs';
for (const file of ['.env', '.env.local']) if (existsSync(file)) process.loadEnvFile(file);
const names = ['CLOUDFLARE_ACCESS_CLIENT_ID','CLOUDFLARE_ACCESS_CLIENT_SECRET','LOCAL_PRODUCTION_BACKUP_BRIDGE_SECRET'];
if (names.some(name => !process.env[name])) process.exit(2);
try {
  const response = await fetch(process.argv[1], {redirect:'error', signal:AbortSignal.timeout(20000), headers:{
    'CF-Access-Client-Id':process.env[names[0]], 'CF-Access-Client-Secret':process.env[names[1]],
    'X-FSD-Local-Backup-Bridge':process.env[names[2]]}});
  if (!response.ok) process.exit(3);
  const data = await response.json();
  console.log(JSON.stringify({available:data.available,active:data.active,generation:data.generation,
    readOnly:data.readOnly,maintenance:!!data.maintenance,job:!!data.job,
    workingReady:data.backups?.find(b=>b.id===data.active)?.workingReady}));
} catch { process.exit(4); }
'''
    result = subprocess.run(['node', '--input-type=module', '-e', script, BRIDGE_URL], cwd=root,
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Cannot verify the deployed active database. Check local Access/backup bridge credentials and connectivity; refusing to fall back to original production.')
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise RuntimeError('Invalid active-database response; no target selected.') from None


def list_databases(root):
    logs = root / '.wrangler/migration-logs'
    logs.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([str(root / 'node_modules/.bin/wrangler'), 'd1', 'list', '--json',
                             '--config', str(root / 'wrangler.local.json')], cwd=root,
                            env={**os.environ, 'WRANGLER_LOG_PATH': str(logs), 'WRANGLER_SEND_METRICS': 'false'},
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Cannot list D1 metadata. Check Wrangler account access; no target selected.')
    return json.loads(result.stdout)


def select_target(status, databases):
    if status.get('available') is not True or not isinstance(status.get('generation'), int):
        raise RuntimeError('Production status is unavailable or invalid; no target selected.')
    if status.get('readOnly') or status.get('maintenance') or status.get('job'):
        raise RuntimeError('Production is previewing a backup or running maintenance/a job. Finish that operation before preparing migrations.')
    active = status.get('active')
    if active == 'production':
        matches = [d for d in databases if d.get('uuid') == ORIGINAL_ID]
    else:
        if not isinstance(active, str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', active) or status.get('workingReady') is not True:
            raise RuntimeError('Active restored database is not ready or has an invalid identity.')
        matches = [d for d in databases if d.get('name') == 'fsd-backup-' + active]
    if len(matches) != 1 or not re.fullmatch(r'[0-9a-fA-F-]{36}', matches[0].get('uuid', '')):
        raise RuntimeError('Active production database metadata is missing or ambiguous.')
    return {'active': active, 'generation': status['generation'], 'database_id': matches[0]['uuid'],
            'database_name': matches[0]['name']}


def resolve(root):
    before = bridge_status(root)
    target = select_target(before, list_databases(root))
    after = bridge_status(root)
    if any(before.get(key) != after.get(key) for key in ('active','generation','readOnly','maintenance','job','workingReady')):
        raise RuntimeError('Active production changed during target resolution; retry after it is stable.')
    return target


def verify(root, target):
    status = bridge_status(root)
    if status.get('active') != target['active'] or status.get('generation') != target['generation'] or status.get('readOnly') or status.get('maintenance') or status.get('job') or status.get('available') is not True:
        raise RuntimeError('Active production changed or is unavailable. Stopped; do not retry writes without inspecting the live ledger.')
    if target['active'] != 'production' and status.get('workingReady') is not True:
        raise RuntimeError('Active production is no longer ready.')


@contextmanager
def configuration(root, target):
    config = json.loads((root / 'wrangler.local.json').read_text())
    binding = next(b for b in config['d1_databases'] if b['binding'] == 'PRODUCTION_DB')
    if binding.get('database_id') != ORIGINAL_ID or binding.get('remote') is not True:
        raise RuntimeError('Original production binding changed; review configuration before proceeding.')
    binding.update(database_id=target['database_id'], database_name=target['database_name'],
                   migrations_dir=str(root / 'migrations'))
    # Only the explicit target is needed; no local bindings or secrets are copied.
    minimal = {'name':'fsd-production-migration', 'compatibility_date':config.get('compatibility_date','2026-09-03'),
               'd1_databases':[binding]}
    with tempfile.TemporaryDirectory(prefix='fsd-production-target-') as directory:
        path = Path(directory) / 'wrangler.json'
        path.write_text(json.dumps(minimal))
        path.chmod(0o600)
        yield path
