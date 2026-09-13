#!/usr/bin/env python3
"""Run guarded historical imports in checklist order, stopping at the first review."""

import argparse
import datetime
import importlib.util
import json
import pathlib
import re
import sqlite3
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "free-spirit-dance-import.sqlite"
CHECKLIST = ROOT / "docs" / "historical-import-checklist.md"
REVIEWS = ROOT / ".wrangler" / "import-reviews"
IDENTITY_CONFIRMATIONS = REVIEWS / "identity-confirmations.json"
SKILL_HELPER = pathlib.Path("/home/alex/.codex/skills/fsd-student-import/scripts/historical-catalog-import.py")
ITEM = re.compile(r"^- \[ \] (?P<name>.+) \(ID (?P<id>\d+)\)$")


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def unchecked():
    return [(match.group("name"), int(match.group("id"))) for line in CHECKLIST.read_text().splitlines() if (match := ITEM.match(line))]


def source_counts(db, student_id):
    return {table: db.execute(f"SELECT COUNT(*) FROM {table} WHERE student_id=?", (str(student_id),)).fetchone()[0] for table in ("attendance", "student_payments", "history_absences", "history_payment_periods", "history_source_cells")}


def backup_and_clear_audit(student_id, name):
    """Only remove stale audit rows when there is no historical activity to lose."""
    with sqlite3.connect(DOCS) as db:
        counts = source_counts(db, student_id)
        meaningful = ("attendance", "student_payments", "history_absences", "history_payment_periods")
        if any(counts[table] for table in meaningful) or not counts["history_source_cells"]:
            return False
        review = REVIEWS / f"{slug(name)}-audit-only-reconciliation-{stamp()}"
        review.mkdir(parents=True)
        with sqlite3.connect(review / "before.sqlite") as copy:
            db.backup(copy)
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM history_source_cells WHERE student_id=?", (str(student_id),))
        db.commit()
        assert_integrity(db)
        (review / "summary.json").write_text(json.dumps({"student": name, "studentId": student_id, "removedAuditRows": counts["history_source_cells"]}, indent=2) + "\n")
    return True


def assert_integrity(db):
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("SQLite integrity or foreign-key verification failed")


def slug(name):
    return "-".join(name.casefold().split())


def stamp():
    return datetime.datetime.now().strftime("%Y%m%d-%H%M%S")


def workbook_records(helper, name):
    source = helper.read_text().split("parser = argparse.ArgumentParser", 1)[0]
    namespace = {"__name__": "batch_extractor"}
    exec(source, namespace)
    return namespace["extract"](name)


def stored_facts(db, student_id):
    return {(row["source_cell"], row["date"], int(row["course_id"]), row["raw_mark"].casefold(), row["fill_argb"], row["new_payment"] == "1") for row in db.execute("SELECT source_cell,date,course_id,raw_mark,fill_argb,new_payment FROM history_source_cells WHERE student_id=?", (str(student_id),))}


def workbook_facts(records):
    return {(row["source"], row["date"], row["course"], row["mark"].casefold(), row["fill"], row["payment"]) for row in records if "2024-01-01" <= row["date"] <= "2026-05-31"}


def exact_existing_history(helper, name, student_id):
    records = workbook_records(helper, name)
    with sqlite3.connect(DOCS) as db:
        db.row_factory = sqlite3.Row
        counts = source_counts(db, student_id)
        meaningful = ("attendance", "student_payments", "history_absences", "history_payment_periods")
        if not any(counts[table] for table in meaningful):
            return False
        assert_integrity(db)
        if stored_facts(db, student_id) != workbook_facts(records):
            raise RuntimeError("Existing historical facts differ from the current in-scope workbook cells")
    return True


def exact_identity(sync, name, student_id):
    catalog = sync.catalog_path()
    for label, path in (("source", DOCS), ("catalog", catalog)):
        with sqlite3.connect(path) as db:
            exact = db.execute("SELECT first_name || ' ' || last_name FROM students WHERE id=?", (student_id,)).fetchall()
            if len(exact) != 1 or exact[0][0].casefold() != name.casefold():
                raise RuntimeError(f"{label} profile does not exactly match checklist identity")
            last_name = name.rsplit(" ", 1)[-1]
            related = db.execute("SELECT id FROM students WHERE lower(last_name)=lower(?) AND id<>?", (last_name, student_id)).fetchall()
            confirmed = set(json.loads(IDENTITY_CONFIRMATIONS.read_text()).get("separatePeople", [])) if IDENTITY_CONFIRMATIONS.exists() else set()
            if related and str(student_id) not in confirmed:
                raise RuntimeError(f"Identity review required: same-surname profile(s) in {label}: {[row[0] for row in related]}")


def mark_complete(name, student_id):
    old = f"- [ ] {name} (ID {student_id})"
    text = CHECKLIST.read_text()
    if text.count(old) != 1:
        raise RuntimeError("Checklist entry changed during batch run")
    CHECKLIST.write_text(text.replace(old, f"- [x] {name} (ID {student_id})", 1))


def run_import(helper, name):
    result = subprocess.run([sys.executable, str(helper), "import", "--student", name], cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply guarded local Catalog syncs and update the checklist")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of students to process")
    args = parser.parse_args()
    if not args.apply:
        raise SystemExit("Refusing to run without --apply; no databases were changed.")
    if not SKILL_HELPER.exists():
        raise SystemExit("The required fsd-student-import helper is unavailable.")
    sync = load_module(ROOT / "scripts" / "sync-historical-catalog.py", "historical_sync")
    for name, student_id in unchecked()[:args.limit]:
        try:
            exact_identity(sync, name, student_id)
            preserved = exact_existing_history(SKILL_HELPER, name, student_id)
            if not preserved:
                try:
                    run_import(SKILL_HELPER, name)
                except RuntimeError:
                    if not backup_and_clear_audit(student_id, name):
                        raise
                    run_import(SKILL_HELPER, name)
            result = subprocess.run(["npm", "run", "historical:sync", "--", "--student", name, "--apply"], cwd=ROOT, text=True)
            if result.returncode:
                raise RuntimeError("Local Catalog synchronization failed")
            mark_complete(name, student_id)
            print(json.dumps({"student": name, "studentId": student_id, "status": "complete", "preservedExistingHistory": preserved}))
        except Exception as error:
            print(json.dumps({"student": name, "studentId": student_id, "status": "stopped", "reason": str(error)}))
            raise SystemExit(1)


if __name__ == "__main__":
    main()
