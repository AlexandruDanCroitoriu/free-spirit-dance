#!/usr/bin/env python3
"""Mark historically seeded students in the dedicated local Catalog D1 binding."""

import json
import os
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/free-spirit-dance-import.sqlite"
CONFIG = ROOT / "wrangler.local.json"
IMPORT_ACTOR = "historical-import@free-spirit-dance.invalid"


def backfill_sql(ids):
    if not ids:
        return "SELECT 0 AS added;"
    values = ",".join(f"({int(student_id)})" for student_id in ids)
    return f"""INSERT INTO student_profile_log (student_id, administrator_email, action, created_at)
        SELECT s.id, '{IMPORT_ACTOR}', 'created',
          COALESCE((SELECT replace(imported_at, ' ', 'T') || 'Z' FROM _fsd_catalog_import LIMIT 1), '1970-01-01T00:00:00Z')
        FROM students s JOIN (VALUES {values}) AS source ON source.column1 = s.id
        WHERE NOT EXISTS (SELECT 1 FROM student_profile_log log WHERE log.student_id = s.id AND log.action = 'created');
        SELECT changes() AS added;"""


def execute(query):
    logs = ROOT / ".wrangler/catalog-logs"
    logs.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([
        str(ROOT / "node_modules/.bin/wrangler"), "d1", "execute", "CATALOG_DB", "--local",
        "--config", str(CONFIG), "--command", query, "--json",
    ], cwd=ROOT, env={**os.environ, "WRANGLER_LOG_PATH": str(logs), "WRANGLER_SEND_METRICS": "false"},
        capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Local Catalog profile history update failed; see .wrangler/catalog-logs.")
    return json.loads(result.stdout)


def main():
    if not SOURCE.exists():
        print("Catalog profile history skipped: historical source is absent.")
        return
    config = json.loads(CONFIG.read_text())
    binding = next(item for item in config["d1_databases"] if item["binding"] == "CATALOG_DB")
    if binding.get("remote") is not False or binding["database_id"] != "00000000-0000-0000-0000-000000000002":
        raise RuntimeError("Catalog profile history requires the dedicated local-only binding.")
    tables = {row["name"] for row in execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('_fsd_catalog_import', 'student_profile_log')")[0]["results"]}
    if "_fsd_catalog_import" not in tables:
        print("Catalog profile history skipped: local Catalog is not prepared.")
        return
    if "student_profile_log" not in tables:
        raise RuntimeError("Apply local Catalog migrations before adding profile history.")
    with sqlite3.connect(f"file:{SOURCE}?mode=ro", uri=True) as history:
        ids = [row[0] for row in history.execute("SELECT id FROM students")]
    result = execute(backfill_sql(ids))
    print(f"Catalog profile history: {result[-1]['results'][0]['added']} historical import entries added.")


if __name__ == "__main__":
    main()
