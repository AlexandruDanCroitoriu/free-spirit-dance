"""Seed a separate local-only D1 database once, preserving later catalog edits."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/free-spirit-dance-import.sqlite"
CONFIG = ROOT / "wrangler.local.json"


def identifier(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + value.replace("'", "''") + "'"


def catalog_sql(source):
    """Create all tables before rows, and triggers after historical inserts."""
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("The prepared catalog database failed integrity checks.")
        objects = db.execute("SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
        statements = ["PRAGMA defer_foreign_keys=ON;"]
        tables = [(name, sql) for kind, name, sql in objects if kind == "table"]
        statements.extend(sql + ";" for _, sql in tables)
        for name, _ in tables:
            for row in db.execute("SELECT * FROM " + identifier(name)):
                statements.append("INSERT INTO " + identifier(name) + " VALUES (" + ",".join(map(literal, row)) + ");")
        statements.extend(sql + ";" for kind, _, sql in objects if kind != "table")
        statements.append("CREATE TABLE _fsd_catalog_import (source_sha256 TEXT NOT NULL, imported_at TEXT NOT NULL);")
        statements.append("INSERT INTO _fsd_catalog_import VALUES (" + literal(hashlib.sha256(source.read_bytes()).hexdigest()) + ", datetime('now'));")
        statements.append("PRAGMA defer_foreign_keys=OFF;")
        return "\n".join(statements)


def execute(*args):
    # This configuration and --local are fixed: this command cannot select production.
    config = json.loads(CONFIG.read_text())
    catalog = next(binding for binding in config["d1_databases"] if binding["binding"] == "CATALOG_DB")
    if catalog.get("remote") is not False or catalog["database_id"] != "00000000-0000-0000-0000-000000000002":
        raise RuntimeError("Catalog preparation requires the dedicated local-only binding.")
    logs = ROOT / ".wrangler/catalog-logs"
    logs.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [str(ROOT / "node_modules/.bin/wrangler"), "d1", "execute", "CATALOG_DB", "--local", "--config", str(CONFIG), "--json", *args],
        cwd=ROOT, env={**os.environ, "WRANGLER_LOG_PATH": str(logs), "WRANGLER_SEND_METRICS": "false"}, capture_output=True, text=True,
    )
    if result.returncode:
        # SQL failures can contain private rows; do not print the SQL or subprocess output.
        raise RuntimeError("Catalog preparation failed. Local and Production were not modified. See .wrangler/catalog-logs for diagnostics.")
    return json.loads(result.stdout)


def main():
    rows = execute("--command", "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")[0]["results"]
    names = {row["name"] for row in rows}
    if "_fsd_catalog_import" in names:
        print("Catalog is already prepared; keeping your local catalog edits.")
        return
    if names:
        raise RuntimeError("Catalog storage already contains tables without a completed import. Refusing to overwrite it.")
    if not SOURCE.exists():
        print("Catalog skipped: docs/free-spirit-dance-import.sqlite is not present on this computer.")
        return
    sql = catalog_sql(SOURCE)
    # Validate the full import, including deferred references, before invoking D1.
    with sqlite3.connect(":memory:") as validation:
        validation.execute("PRAGMA foreign_keys=ON")
        validation.executescript("BEGIN;\n" + sql + "\nCOMMIT;")
        if validation.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Catalog import failed foreign-key validation.")
    with tempfile.TemporaryDirectory(prefix="fsd-catalog-") as directory:
        dump = Path(directory) / "catalog.sql"
        dump.write_text(sql)
        dump.chmod(0o600)
        execute("--file", str(dump))
    results = execute("--command", "PRAGMA foreign_key_check; SELECT COUNT(*) AS students FROM students; SELECT COUNT(*) AS attendance FROM attendance; SELECT COUNT(*) AS payments FROM student_payments;")
    if results[0]["results"]:
        raise RuntimeError("Catalog import has invalid references.")
    counts = {key: value for result in results[1:] for row in result["results"] for key, value in row.items()}
    print("Catalog prepared locally: " + ", ".join(f"{value} {key}" for key, value in counts.items()) + ".")


if __name__ == "__main__":
    main()
