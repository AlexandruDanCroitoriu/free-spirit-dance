#!/usr/bin/env python3
"""Apply the app schema to the dedicated local-only production working copy."""

import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "wrangler.local.json"


def prepare(binding_name, database_id):
    config = json.loads(CONFIG.read_text())
    binding = next((item for item in config["d1_databases"] if item["binding"] == binding_name), None)
    if not binding or binding.get("remote") is not False or binding.get("database_id") != database_id:
        raise RuntimeError("Working-copy preparation requires the dedicated local-only D1 binding.")
    logs = ROOT / ".wrangler" / "catalog-logs"
    logs.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [str(ROOT / "node_modules/.bin/wrangler"), "d1", "migrations", "apply", binding_name, "--local", "--config", str(CONFIG)],
        cwd=ROOT,
        env={**os.environ, "WRANGLER_LOG_PATH": str(logs), "WRANGLER_SEND_METRICS": "false"},
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError("Working-copy preparation failed. Production was not modified; see .wrangler/catalog-logs for diagnostics.")
    print("Local production working-copy schema is ready.")


if __name__ == "__main__":
    prepare("WORKING_DB", "00000000-0000-0000-0000-000000000003")
    for index in range(2, 9):
        prepare(f"COPY{index}_DB", f"00000000-0000-0000-0000-{index + 3:012d}")
