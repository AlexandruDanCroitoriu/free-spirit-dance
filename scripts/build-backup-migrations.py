"""Bundle ordered SQL statements for the backup restore Worker."""
import json
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parents[1]
entries = []
for path in sorted((root / 'migrations').glob('*.sql')):
    statements, pending = [], ''
    for character in path.read_text():
        pending += character
        if character == ';' and sqlite3.complete_statement(pending):
            statements.append(pending.strip())
            pending = ''
    if pending.strip() and not all(not line.strip() or line.lstrip().startswith('--') for line in pending.splitlines()):
        raise RuntimeError(f'Incomplete migration: {path.name}')
    entries.append({'name': path.name, 'statements': statements})
(root / 'app/lib/production-backups/migrations.generated.json').write_text(json.dumps(entries, indent=2) + '\n')
