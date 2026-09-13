#!/usr/bin/env python3
"""Reusable evidence, backup, and candidate-validation steps for one historical student import."""

import argparse
import datetime
import json
import pathlib
import re
import sqlite3
import zipfile
import xml.etree.ElementTree as ET

# The skill runs from the selected Free Spirit Dance checkout, while this file may
# live in the skill directory. Keep all project paths relative to that checkout.
ROOT = pathlib.Path.cwd()
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
MONTHS = {name: number for number, name in enumerate("ianuarie februarie martie aprilie mai iunie iulie august septembrie octombrie noiembrie decembrie".split(), 1)}
MONTHS["dec"] = 12
SHEETS = {
    "Prezenta Grupa Mica": (1, "Beginners", 2024), "Prezenta Grupa Mica 2025": (1, "Beginners", 2025), "incepatori 26": (1, "Beginners", 2026),
    "Prezenta grupa intermediari": (2, "Intermediates", 2023), "Prezenta grupa intermediari 202": (2, "Intermediates", 2025), "intermed 26": (2, "Intermediates", 2026),
}

def student_key(value): return " ".join(value.casefold().split())
def column(reference): return re.match(r"[A-Z]+", reference).group(0)
def backup(source, target):
    target.unlink(missing_ok=True)
    destination = sqlite3.connect(target)
    source.backup(destination)
    destination.close()

def extract(args):
    target = student_key(args.student)
    review = pathlib.Path(args.review_dir)
    review.mkdir(parents=True, exist_ok=True)
    workbook = zipfile.ZipFile(ROOT / "docs" / "Catalog FSD.xlsx")
    strings = ["".join(item.itertext()) for item in ET.fromstring(workbook.read("xl/sharedStrings.xml")).findall("m:si", NS)]
    rels = {item.attrib["Id"]: item.attrib["Target"] for item in ET.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))}
    styles_root = ET.fromstring(workbook.read("xl/styles.xml"))
    fills, styles = list(styles_root.find("m:fills", NS)), list(styles_root.find("m:cellXfs", NS))
    records = []
    for sheet in ET.fromstring(workbook.read("xl/workbook.xml")).find("m:sheets", NS):
        name = sheet.attrib["name"]
        if name not in SHEETS: continue
        relationship = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        path = rels[relationship]; path = path.lstrip("/") if path.startswith("/") else "xl/" + path
        root = ET.fromstring(workbook.read(path))
        cells = {cell.attrib["r"]: cell for cell in root.findall(".//m:sheetData/m:row/m:c", NS)}
        def value(reference):
            cell = cells.get(reference)
            if cell is None: return ""
            raw = cell.findtext("m:v", default="", namespaces=NS)
            return strings[int(raw)] if cell.attrib.get("t") == "s" and raw else raw
        matches = [reference for reference in cells if student_key(value(reference)) == target]
        if len(matches) > 1: raise ValueError(f"Ambiguous student headings in {name}: {matches}")
        if not matches: continue
        student_column = column(matches[0]); course_id, course_name, year = SHEETS[name]; month = None; previous_day = None
        for row in root.findall(".//m:sheetData/m:row", NS):
            row_number = int(row.attrib["r"]); label = value(f"A{row_number}").strip().casefold()
            if label in MONTHS:
                previous_month = month
                labelled_month = MONTHS[label]
                if month is None or labelled_month > month:
                    month = labelled_month
                elif month == 12 and labelled_month == 1:
                    month = labelled_month; year += 1
                if month != previous_month:
                    previous_day = None
            day, reference = value(f"B{row_number}").strip(), f"{student_column}{row_number}"
            if day.isdigit() and month is not None:
                if previous_day is not None and int(day) < previous_day:
                    if month == 12:
                        month = 1; year += 1
                    else:
                        month += 1
                previous_day = int(day)
            cell, mark = cells.get(reference), value(reference).strip().casefold(); fill = ""
            if cell is not None:
                fill_id = int(styles[int(cell.attrib.get("s", "0"))].attrib["fillId"])
                color = fills[fill_id].find("m:patternFill/m:fgColor", NS)
                fill = color.attrib.get("rgb", "") if color is not None else ""
            new_payment = fill[-6:] in {"B6D7A8", "6AA84F"}
            if not day.isdigit() or month is None or (not mark and not new_payment): continue
            records.append({"date": datetime.date(year, month, int(day)).isoformat(), "courseId": course_id, "courseName": course_name, "mark": mark, "fill": fill, "newPayment": new_payment, "source": f"{name}!{reference}"})
    if not records: raise ValueError(f"No workbook records found for {args.student!r}")
    (review / "workbook-records.json").write_text(json.dumps(records, indent=2))
    print(json.dumps({"student": args.student, "records": len(records), "payments": sorted({record["date"] for record in records if record["newPayment"]})}, indent=2))

def snapshot(args):
    review = pathlib.Path(args.review_dir); review.mkdir(parents=True, exist_ok=True)
    docs = sqlite3.connect(ROOT / "docs" / "free-spirit-dance-import.sqlite")
    backup(docs, review / "docs-before.sqlite"); docs.close()
    catalog = sqlite3.connect(review / "catalog-before.sqlite")
    catalog.executescript((review / "catalog-before.sql").read_text()); catalog.close()
    print("Created SQLite-backup-API snapshots for docs and exported Catalog.")

def quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def plan(args):
    """Build a narrow, repeatable, source-audited change set for one student."""
    review = pathlib.Path(args.review_dir)
    records = json.loads((review / "workbook-records.json").read_text())
    cutoff = args.cutoff
    database = sqlite3.connect(ROOT / "docs" / "free-spirit-dance-import.sqlite")
    database.row_factory = sqlite3.Row
    student = database.execute("SELECT id, first_name || ' ' || last_name AS name FROM students WHERE lower(first_name || ' ' || last_name) = lower(?)", (args.student,)).fetchall()
    if len(student) != 1: raise ValueError(f"Expected one student named {args.student!r}, found {len(student)}")
    student_id, student_name = student[0]["id"], student[0]["name"]
    if any(database.execute(f"SELECT 1 FROM {table} WHERE student_id = ? LIMIT 1", (student_id,)).fetchone() for table in ("attendance", "student_payments")):
        raise ValueError("Student already has activity; prepare a correction rather than an import plan")
    in_scope = [record for record in records if record["date"] <= cutoff]
    if not in_scope: raise ValueError("No source records fall within the requested import window")
    marks = {"p", "pc", "a", "am"}
    if any(record["mark"] not in marks and not (record["mark"] == "" and record["newPayment"]) for record in in_scope): raise ValueError("Unrecognized in-scope marks require review")
    for record in in_scope:
        found = database.execute("SELECT id FROM classes WHERE course_id = ? AND class_date = ? AND cancelled = 0", (record["courseId"], record["date"])).fetchall()
        if len(found) != 1: raise ValueError(f"Expected one held class for {record['source']}, found {len(found)}")
    payments = sorted({record["date"] for record in records if record["newPayment"]})
    in_scope_payments = [date for date in payments if date <= cutoff]
    stamp = datetime.datetime.now(datetime.UTC).isoformat()
    actor = "historical-import@free-spirit-dance.invalid"
    lines = ["-- Generated from the reviewed workbook extraction. Do not edit source facts here."]
    for index, paid_on in enumerate(in_scope_payments):
        next_payment = next((date for date in payments if date > paid_on), None)
        period = [record for record in in_scope if record["date"] >= paid_on and (next_payment is None or record["date"] < next_payment)]
        counts = {course_id: sum(record["courseId"] == course_id and record["mark"] in marks for record in period) for course_id in (1, 2)}
        sources = [record["source"] for record in records if record["date"] == paid_on and record["newPayment"]]
        source_text = "; ".join(sources)
        key = f"history-{student_id}-payment-{paid_on}"
        boundary = f" Coverage [{paid_on}, {next_payment});" if next_payment else " Coverage unresolved;"
        if next_payment and next_payment > cutoff:
            boundary += f" next-payment boundary is outside import scope ({next_payment}) and no outside-window activity was imported;"
        notes = f"Historical custom payment for Beginners and Intermediates; source: {source_text}. Amount, method, collector and school handover unknown. recorded_at is import preparation time.{boundary} allowances count only explicitly recorded held classes, excluding blanks."
        payload = json.dumps({"historical": True, "sourceCells": source_text, "courses": [1, 2], "nextPaymentOn": next_payment}, separators=(",", ":"))
        lines.append(f"INSERT INTO student_payments (student_id, paid_on, amount_minor, notes, recorded_by, recorded_at, request_key, request_payload, given_to_school, received_method) SELECT {student_id}, {quote(paid_on)}, 0, {quote(notes)}, {quote(actor)}, {quote(stamp)}, {quote(key)}, {quote(payload)}, 0, '' WHERE EXISTS (SELECT 1 FROM students WHERE id = {student_id}) AND NOT EXISTS (SELECT 1 FROM student_payments WHERE request_key = {quote(key)});")
        for course_id, course_name in ((1, "Beginners"), (2, "Intermediates")):
            if counts[course_id]:
                lines.append(f"INSERT INTO payment_course_allowances (payment_id, course_id, course_name, allowance) SELECT id, {course_id}, {quote(course_name)}, {counts[course_id]} FROM student_payments WHERE request_key = {quote(key)} AND NOT EXISTS (SELECT 1 FROM payment_course_allowances WHERE payment_id = student_payments.id AND course_id = {course_id});")
        through = (datetime.date.fromisoformat(next_payment) - datetime.timedelta(days=1)).isoformat() if next_payment else ""
        status = "Resolved interval; allowances count explicit held records only, blanks excluded"
        if next_payment and next_payment > cutoff: status += ". Resolved using recorded next payment outside import scope; outside-window activity not imported."
        values = [f"CAST((SELECT id FROM student_payments WHERE request_key = {quote(key)}) AS TEXT)", quote(student_id), quote(student_name), quote(paid_on), "'0'", "'Custom: Beginners + Intermediates'", quote(next_payment or ""), quote(through), quote(counts[1] or ""), quote(counts[2] or ""), quote(source_text), quote(status)]
        lines.append("INSERT INTO history_payment_periods (review_payment_id, student_id, student_name, paid_on, amount_minor, payment_type, next_payment_on, coverage_through, beginners_allowance, intermediates_allowance, source_cells, review_status) SELECT " + ", ".join(values) + f" WHERE NOT EXISTS (SELECT 1 FROM history_payment_periods WHERE student_id = {quote(student_id)} AND paid_on = {quote(paid_on)});")
    for record in in_scope:
        course_id, course_name, date, mark, source = record["courseId"], record["courseName"], record["date"], record["mark"], record["source"]
        class_id = f"(SELECT id FROM classes WHERE course_id = {course_id} AND class_date = {quote(date)} AND cancelled = 0)"
        class_time = f"(SELECT start_time FROM classes WHERE course_id = {course_id} AND class_date = {quote(date)} AND cancelled = 0)"
        if mark in {"p", "pc"}:
            key = f"history-{student_id}-attendance-{course_id}-{date}"
            notes = f"Historical catalog import; source: {source}. Collector and original recording time unknown."
            lines.append(f"INSERT INTO attendance (student_id, course_id, course_name, attended_at, recorded_by, recorded_at, notes, request_key, request_payload, class_id, complimentary) SELECT {student_id}, {course_id}, {quote(course_name)}, {quote(date)} || 'T' || {class_time} || ':00', {quote(actor)}, NULL, {quote(notes)}, {quote(key)}, '{{}}', {class_id}, 0 WHERE NOT EXISTS (SELECT 1 FROM attendance WHERE student_id = {student_id} AND course_id = {course_id} AND class_id = {class_id});")
        elif mark in {"a", "am"}:
            status = "Explicit absence; visible only with resolved payment coverage"
            lines.append(f"INSERT INTO history_absences (student_id, student_name, course_id, course_name, class_id, class_date, start_time, mark, source_cells, review_status) SELECT {quote(student_id)}, {quote(student_name)}, {quote(course_id)}, {quote(course_name)}, CAST({class_id} AS TEXT), {quote(date)}, {class_time}, {quote(mark)}, {quote(source)}, {quote(status)} WHERE NOT EXISTS (SELECT 1 FROM history_absences WHERE student_id = {quote(student_id)} AND course_id = {quote(course_id)} AND class_id = CAST({class_id} AS TEXT));")
        lines.append(f"INSERT INTO history_source_cells (student_id, student_name, source_name, date, course_id, course_name, class_id, raw_mark, fill_argb, new_payment, source_cell, mapping_status) SELECT {quote(student_id)}, {quote(student_name)}, {quote(args.student)}, {quote(date)}, {quote(course_id)}, {quote(course_name)}, CAST({class_id} AS TEXT), {quote(mark)}, {quote(record['fill'])}, {quote('1' if record['newPayment'] else '0')}, {quote(source)}, 'Mapped' WHERE NOT EXISTS (SELECT 1 FROM history_source_cells WHERE student_id = {quote(student_id)} AND source_cell = {quote(source)});")
    database.close()
    (review / "changes.sql").write_text("\n".join(lines) + "\n")
    print(json.dumps({"studentId": student_id, "inScopeRecords": len(in_scope), "payments": in_scope_payments, "attendance": sum(record["mark"] in {"p", "pc"} for record in in_scope), "absences": sum(record["mark"] in {"a", "am"} for record in in_scope)}, indent=2))

def validate(args):
    review = pathlib.Path(args.review_dir); sql = (review / "changes.sql").read_text()
    for name in ("docs", "catalog"):
        source = sqlite3.connect(review / f"{name}-before.sqlite")
        candidate_path = review / f"{name}-candidate.sqlite"; backup(source, candidate_path); source.close()
        candidate = sqlite3.connect(candidate_path); candidate.execute("PRAGMA foreign_keys = ON")
        candidate.executescript("BEGIN;\n" + sql + "COMMIT;")
        changes = candidate.total_changes
        candidate.executescript("BEGIN;\n" + sql + "COMMIT;")
        if candidate.total_changes != changes: raise RuntimeError(f"{name} SQL is not idempotent")
        if candidate.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or candidate.execute("PRAGMA foreign_key_check").fetchall(): raise RuntimeError(f"{name} candidate integrity failure")
        candidate.close()
    print("Validated both candidates transactionally, including an idempotent rerun and foreign keys.")

def apply_docs(args):
    review = pathlib.Path(args.review_dir)
    database = sqlite3.connect(ROOT / "docs" / "free-spirit-dance-import.sqlite")
    database.execute("PRAGMA foreign_keys = ON")
    database.executescript("BEGIN;\n" + (review / "changes.sql").read_text() + "COMMIT;")
    if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or database.execute("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("Docs integrity failure after apply")
    database.close()
    print("Applied the reviewed SQL to docs SQLite transactionally.")

def checklist(args):
    database = sqlite3.connect(ROOT / "docs" / "free-spirit-dance-import.sqlite")
    database.row_factory = sqlite3.Row
    rows = database.execute("""
      WITH expected AS (
        SELECT CAST(student_id AS INTEGER) AS student_id,
          SUM(LOWER(raw_mark) IN ('p', 'pc')) AS attendance,
          SUM(LOWER(raw_mark) IN ('a', 'am')) AS absences,
          COUNT(DISTINCT CASE WHEN new_payment = '1' THEN date END) AS payments
        FROM history_source_cells GROUP BY CAST(student_id AS INTEGER)
      ), actual AS (
        SELECT s.id AS student_id,
          (SELECT COUNT(*) FROM attendance a WHERE a.student_id = s.id) AS attendance,
          (SELECT COUNT(*) FROM history_absences a WHERE a.student_id = CAST(s.id AS TEXT)) AS absences,
          (SELECT COUNT(*) FROM student_payments p WHERE p.student_id = s.id) AS payments
        FROM students s
      )
      SELECT s.id, s.first_name || ' ' || s.last_name AS name, expected.attendance, expected.absences, expected.payments,
        actual.attendance AS actual_attendance, actual.absences AS actual_absences, actual.payments AS actual_payments
      FROM expected JOIN actual ON actual.student_id = expected.student_id JOIN students s ON s.id = expected.student_id
      ORDER BY LOWER(s.last_name), LOWER(s.first_name), s.id
    """).fetchall()
    database.close()
    pending = [row for row in rows if (row['attendance'], row['absences'], row['payments']) != (row['actual_attendance'], row['actual_absences'], row['actual_payments'])]
    complete = [row for row in rows if row not in pending]
    lines = ["# Historical student import checklist", "", "Private local working list generated from workbook source mappings and the Catalog SQLite state. Check an item only after that student has been individually verified from `Catalog FSD.xlsx` and synchronized to Catalog.", "", f"{len(pending)} students remain; {len(complete)} are currently complete.", "", "## Remaining imports", ""]
    lines.extend(f"- [ ] {row['name']} (ID {row['id']})" for row in pending)
    lines.extend(["", "## Completed", ""])
    lines.extend(f"- [x] {row['name']} (ID {row['id']})" for row in complete)
    pathlib.Path(args.output).write_text("\n".join(lines) + "\n")
    print(f"Wrote {len(pending)} pending and {len(complete)} complete students to {args.output}.")

parser = argparse.ArgumentParser(description=__doc__)
commands = parser.add_subparsers(dest="command", required=True)
for name, handler in (("extract", extract), ("snapshot", snapshot), ("plan", plan), ("validate", validate), ("apply-docs", apply_docs), ("checklist", checklist)):
    command = commands.add_parser(name); command.set_defaults(handler=handler)
    if name != "checklist": command.add_argument("--review-dir", required=True)
    if name == "extract": command.add_argument("--student", required=True)
    if name == "plan":
        command.add_argument("--student", required=True)
        command.add_argument("--cutoff", default="2026-05-31")
    if name == "checklist": command.add_argument("--output", required=True)
args = parser.parse_args(); args.handler(args)
