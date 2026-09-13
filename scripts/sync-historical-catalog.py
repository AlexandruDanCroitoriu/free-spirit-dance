#!/usr/bin/env python3
"""Safely reconcile one student's historical rows into the local Catalog D1 copy."""

import argparse
import datetime
import json
import pathlib
import sqlite3
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "free-spirit-dance-import.sqlite"
CONFIG = ROOT / "wrangler.local.json"
STATE = ROOT / ".wrangler" / "state" / "v3" / "d1" / "miniflare-D1DatabaseObject"
REVIEW_ROOT = ROOT / ".wrangler" / "import-reviews"


def quote(value):
    if value is None:
        return "NULL"
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def backup(source, target):
    target.unlink(missing_ok=True)
    with sqlite3.connect(source) as origin, sqlite3.connect(target) as copy:
        origin.backup(copy)


def catalog_path():
    matches = []
    for path in STATE.glob("*.sqlite"):
        try:
            with sqlite3.connect(path) as db:
                marker = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='_fsd_catalog_import'").fetchone()
                if marker:
                    matches.append(path)
        except sqlite3.DatabaseError:
            pass
    if len(matches) != 1:
        raise RuntimeError("Expected exactly one prepared local Catalog database. Run npm run db:catalog:prepare first.")
    return matches[0]


def student(source, name):
    rows = source.execute("SELECT id, first_name || ' ' || last_name AS name FROM students WHERE lower(first_name || ' ' || last_name) = lower(?)", (name,)).fetchall()
    if len(rows) != 1:
        raise RuntimeError(f"Expected exactly one student named {name!r}; found {len(rows)}.")
    return rows[0]


def historical_rows(source, student_id):
    prefix = f"history-{student_id}-%"
    payments = source.execute("SELECT * FROM student_payments WHERE student_id=? AND request_key LIKE ? ORDER BY paid_on, id", (student_id, prefix)).fetchall()
    attendance = source.execute("SELECT * FROM attendance WHERE student_id=? AND request_key LIKE ? ORDER BY attended_at, id", (student_id, prefix)).fetchall()
    absences = source.execute("SELECT * FROM history_absences WHERE student_id=? ORDER BY source_cells", (str(student_id),)).fetchall()
    cells = source.execute("SELECT * FROM history_source_cells WHERE student_id=? ORDER BY source_cell", (str(student_id),)).fetchall()
    periods = source.execute("SELECT * FROM history_payment_periods WHERE student_id=? ORDER BY paid_on", (str(student_id),)).fetchall()
    if not any((payments, attendance, absences, cells, periods)):
        raise RuntimeError("This student has no historical rows in docs. Import and validate the workbook history before synchronizing Catalog.")
    return payments, attendance, absences, cells, periods


def held_class(source, class_id):
    row = source.execute("SELECT course_id, class_date FROM classes WHERE id=? AND cancelled=0", (class_id,)).fetchone()
    if not row:
        raise RuntimeError(f"Historical row refers to missing or cancelled class {class_id}.")
    return row


def class_expression(source, class_id):
    course_id, class_date = held_class(source, class_id)
    return f"(SELECT id FROM classes WHERE course_id={quote(course_id)} AND class_date={quote(class_date)} AND cancelled=0)"


def class_insert(source, class_id):
    row = source.execute("SELECT course_id, class_date, start_time, end_time, cancelled, cancelled_by, cancelled_at, rent_cost_minor, rent_paid FROM classes WHERE id=? AND cancelled=0", (class_id,)).fetchone()
    if not row:
        raise RuntimeError(f"Historical row refers to missing or cancelled class {class_id}.")
    data = dict(row)
    columns = list(data)
    return insert_values("classes", columns, [quote(data[name]) for name in columns], f"SELECT 1 FROM classes WHERE course_id={quote(data['course_id'])} AND class_date={quote(data['class_date'])} AND start_time={quote(data['start_time'])}")


def insert_values(table, columns, values, exists):
    names = ", ".join(columns)
    return f"INSERT INTO {table} ({names}) SELECT {', '.join(values)} WHERE NOT EXISTS ({exists});"


def changes(source, student_id):
    payments, attendance, absences, cells, periods = historical_rows(source, student_id)
    sql = ["-- Generated historical Catalog reconciliation. Do not edit source facts."]
    source_cells = ", ".join(quote(row["source_cell"]) for row in cells)
    if source_cells:
        sql.append(f"DELETE FROM history_source_cells WHERE student_id={quote(student_id)} AND source_cell NOT IN ({source_cells});")
    payment_keys = {}
    class_ids = {int(row["class_id"]) for rows in (attendance, absences, cells) for row in rows if row["class_id"] not in (None, "")}
    for class_id in sorted(class_ids):
        sql.append(class_insert(source, class_id))
    for row in payments:
        data = dict(row)
        key = data["request_key"]
        payment_keys[data["id"]] = key
        columns = [name for name in data if name != "id"]
        sql.append(insert_values("student_payments", columns, [quote(data[name]) for name in columns], f"SELECT 1 FROM student_payments WHERE request_key={quote(key)}"))
        allowances = source.execute("SELECT course_id, course_name, allowance FROM payment_course_allowances WHERE payment_id=? ORDER BY course_id", (data["id"],)).fetchall()
        for allowance in allowances:
            sql.append(insert_values("payment_course_allowances", ["payment_id", "course_id", "course_name", "allowance"], [f"(SELECT id FROM student_payments WHERE request_key={quote(key)})", quote(allowance["course_id"]), quote(allowance["course_name"]), quote(allowance["allowance"])], f"SELECT 1 FROM payment_course_allowances WHERE payment_id=(SELECT id FROM student_payments WHERE request_key={quote(key)}) AND course_id={quote(allowance['course_id'])}"))
    for row in attendance:
        data = dict(row)
        sql.append(f"UPDATE attendance SET complimentary={quote(data['complimentary'])}, complimentary_by={quote(data['complimentary_by'])}, complimentary_at={quote(data['complimentary_at'])} WHERE request_key={quote(data['request_key'])} AND (complimentary IS NOT {quote(data['complimentary'])} OR complimentary_by IS NOT {quote(data['complimentary_by'])} OR complimentary_at IS NOT {quote(data['complimentary_at'])});")
        columns = [name for name in data if name not in {"id", "class_id"}]
        values = [quote(data[name]) for name in columns]
        columns.append("class_id")
        values.append(class_expression(source, data["class_id"]))
        sql.append(insert_values("attendance", columns, values, f"SELECT 1 FROM attendance WHERE request_key={quote(data['request_key'])}"))
    for row in absences:
        data = dict(row)
        values = [class_expression(source, int(data[name])) if name == "class_id" else quote(data[name]) for name in data]
        sql.append(insert_values("history_absences", list(data), values, f"SELECT 1 FROM history_absences WHERE student_id={quote(data['student_id'])} AND source_cells={quote(data['source_cells'])}"))
    for row in cells:
        data = dict(row)
        values = [class_expression(source, int(data[name])) if name == "class_id" else quote(data[name]) for name in data]
        sql.append(insert_values("history_source_cells", list(data), values, f"SELECT 1 FROM history_source_cells WHERE student_id={quote(data['student_id'])} AND source_cell={quote(data['source_cell'])}"))
    for row in periods:
        data = dict(row)
        key = payment_keys.get(int(data["review_payment_id"]))
        if not key:
            raise RuntimeError("A historical payment period has no matching historical payment.")
        values = [f"CAST((SELECT id FROM student_payments WHERE request_key={quote(key)}) AS TEXT)" if name == "review_payment_id" else quote(data[name]) for name in data]
        assignments = ", ".join(f"{name}={value}" for name, value in zip(data, values))
        changed = " OR ".join(f"{name} IS NOT {value}" for name, value in zip(data, values))
        sql.append(f"UPDATE history_payment_periods SET {assignments} WHERE student_id={quote(data['student_id'])} AND paid_on={quote(data['paid_on'])} AND ({changed});")
        sql.append(insert_values("history_payment_periods", list(data), values, f"SELECT 1 FROM history_payment_periods WHERE student_id={quote(data['student_id'])} AND paid_on={quote(data['paid_on'])}"))
    return "\n".join(sql) + "\n", {"payments": len(payments), "attendance": len(attendance), "absences": len(absences), "sourceCells": len(cells), "paymentPeriods": len(periods)}


def count_rows(db, student_id):
    prefix = f"history-{student_id}-%"
    return {
        "payments": db.execute("SELECT COUNT(*) FROM student_payments WHERE student_id=? AND request_key LIKE ?", (student_id, prefix)).fetchone()[0],
        "attendance": db.execute("SELECT COUNT(*) FROM attendance WHERE student_id=? AND request_key LIKE ?", (student_id, prefix)).fetchone()[0],
        "absences": db.execute("SELECT COUNT(*) FROM history_absences WHERE student_id=?", (str(student_id),)).fetchone()[0],
        "sourceCells": db.execute("SELECT COUNT(*) FROM history_source_cells WHERE student_id=?", (str(student_id),)).fetchone()[0],
        "paymentPeriods": db.execute("SELECT COUNT(*) FROM history_payment_periods WHERE student_id=?", (str(student_id),)).fetchone()[0],
    }


def verify(db, student_id, expected):
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("Catalog integrity or foreign-key verification failed.")
    actual = count_rows(db, student_id)
    if actual != expected:
        raise RuntimeError(f"Catalog row counts differ from the historical source: expected {expected}, found {actual}.")
    return actual


def validate_and_write(review, catalog, sql, student_id, expected):
    candidate = review / "catalog-candidate.sqlite"
    backup(catalog, candidate)
    with sqlite3.connect(candidate) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript("BEGIN;\n" + sql + "COMMIT;")
        verify(db, student_id, expected)
        before = db.total_changes
        db.executescript("BEGIN;\n" + sql + "COMMIT;")
        if db.total_changes != before:
            raise RuntimeError("Candidate reconciliation is not idempotent.")
    (review / "changes.sql").write_text(sql)


def apply_with_wrangler(sql_file):
    config = json.loads(CONFIG.read_text())
    binding = next((item for item in config["d1_databases"] if item["binding"] == "CATALOG_DB"), None)
    if not binding or binding.get("remote") is not False or binding.get("database_id") != "00000000-0000-0000-0000-000000000002":
        raise RuntimeError("Refusing to use anything except the dedicated local Catalog D1 binding.")
    logs = ROOT / ".wrangler" / "catalog-logs"
    logs.mkdir(parents=True, exist_ok=True)
    command = [str(ROOT / "node_modules/.bin/wrangler"), "d1", "execute", "CATALOG_DB", "--local", "--config", str(CONFIG), "--file", str(sql_file)]
    result = subprocess.run(command, cwd=ROOT, env={**__import__("os").environ, "WRANGLER_LOG_PATH": str(logs), "WRANGLER_SEND_METRICS": "false"}, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Catalog reconciliation failed; the docs database was not changed. See .wrangler/catalog-logs for diagnostics.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--student", required=True)
    parser.add_argument("--apply", action="store_true", help="Apply after candidate validation. The default is a no-write dry run.")
    args = parser.parse_args()
    if not DOCS.exists():
        raise RuntimeError("Historical SQLite source is missing.")
    catalog = catalog_path()
    slug = "-".join(args.student.casefold().split())
    review = REVIEW_ROOT / f"catalog-sync-{slug}-{datetime.datetime.now(datetime.UTC).strftime('%Y%m%d-%H%M%S')}"
    review.mkdir(parents=True)
    with sqlite3.connect(DOCS) as source:
        source.row_factory = sqlite3.Row
        student_id, student_name = student(source, args.student)
        sql, expected = changes(source, student_id)
    backup(DOCS, review / "docs-before.sqlite")
    backup(catalog, review / "catalog-before.sqlite")
    validate_and_write(review, catalog, sql, student_id, expected)
    if args.apply:
        apply_with_wrangler(review / "changes.sql")
        with sqlite3.connect(catalog) as target:
            verify(target, student_id, expected)
    print(json.dumps({"student": student_name, "studentId": student_id, "status": "synchronized" if args.apply else "validated; rerun with --apply to synchronize", "counts": expected, "review": str(review.relative_to(ROOT))}, indent=2))


if __name__ == "__main__":
    main()
