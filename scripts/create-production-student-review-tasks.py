#!/usr/bin/env python3
"""Create one private, linked student-review task per Production student.

The batch is deliberately idempotent: rerunning it only creates cards whose
per-student request key is absent. It never updates student data or existing
tasks. The active Production database is resolved through the backup bridge
before every remote command; it is never assumed to be the static D1 binding.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys

import production_target


ROOT = Path(__file__).resolve().parents[1]
OWNER = "croitoriu.alexandru.code@gmail.com"
KEY_PREFIX = "student-review-2026-v1-"
CHECKLIST = [
    "Validate student attendance and payment coverage to be correct over his course classes.",
    "Review profile details: first name, last name, phone, Instagram, Facebook, profile image, status, email, and assigned courses.",
    "Add a short note to the task if anything could not be verified or needs follow-up.",
]


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def student_description(alias: str) -> str:
    """Rich Tiptap document with an inline student card and three checkboxes."""
    item = lambda text: f"json_object('type','taskItem','attrs',json_object('checked',json('false')),'content',json_array(json_object('type','paragraph','content',json_array(json_object('type','text','text',{quote(text)})))))"
    name = f"COALESCE(NULLIF(trim({alias}.first_name || ' ' || {alias}.last_name), ''), 'Student #' || {alias}.id)"
    items = ','.join(item(text) for text in CHECKLIST)
    return f"'fsd-rich-text-v1:' || json_object('type','doc','content',json_array(json_object('type','paragraph','content',json_array(json_object('type','text','text','Validate '),json_object('type','studentMention','attrs',json_object('id',{alias}.id,'name',{name},'picture',{alias}.picture)))),json_object('type','taskList','content',json_array({items})),json_object('type','codeBlock','attrs',json_object('language','note'))))"


def command(config: Path, *args: str) -> list[str]:
    return [str(ROOT / "node_modules/.bin/wrangler"), "d1", "execute", "PRODUCTION_DB", "--remote", "--config", str(config), *args]


def run(config: Path, sql: str) -> dict:
    result = subprocess.run(command(config, "--command", sql, "--json"), cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"Production D1 command failed. No further command was run. stdout={result.stdout!r}; stderr={result.stderr!r}")
    try:
        return json.loads(result.stdout[result.stdout.index("["):])
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Production D1 returned an unreadable response: stdout={result.stdout!r}; stderr={result.stderr!r}") from error


def rows(data: dict) -> list[dict]:
    return data[0]["results"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the missing cards after the preflight")
    args = parser.parse_args()
    target = production_target.resolve(ROOT)
    print(f"Verified active Production: {target['database_name']} ({target['database_id']}), generation {target['generation']}")
    description = student_description('s')
    preflight = f"""
SELECT
  (SELECT count(*) FROM students) AS students,
  (SELECT count(*) FROM admin_profiles WHERE email = {quote(OWNER)}) AS owner_profile,
  (SELECT count(*) FROM manual_tasks WHERE inbox_owner = {quote(OWNER)} AND request_key LIKE {quote(KEY_PREFIX + '%')}) AS existing_batch_cards,
  (SELECT count(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM manual_tasks t WHERE t.request_key = {quote(KEY_PREFIX)} || s.id)) AS cards_to_create;
"""
    with production_target.configuration(ROOT, target) as config:
        production_target.verify(ROOT, target)
        check = rows(run(config, preflight))[0]
        production_target.verify(ROOT, target)
        print(json.dumps(check, sort_keys=True))
        if check["owner_profile"] != 1:
            raise RuntimeError("The requested Inbox owner has no Production administrator profile. No cards were created.")
        if not args.apply:
            return
        create_cards = f"""
INSERT INTO manual_tasks (title, description, due_date, sort_order, created_by, created_at, updated_by, updated_at, request_key, request_payload, list_id, inbox_owner, administrator_emails, assigned_to, status)
SELECT
  substr('Review: ' || COALESCE(NULLIF(trim(s.first_name || ' ' || s.last_name), ''), 'Student #' || s.id), 1, 200),
  {description}, NULL,
  (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM manual_tasks WHERE inbox_owner = {quote(OWNER)}) + row_number() OVER (ORDER BY s.id) - 1,
  {quote(OWNER)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), {quote(OWNER)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  {quote(KEY_PREFIX)} || s.id,
  json_object('source', 'student-review-2026-v1', 'studentId', s.id),
  NULL, {quote(OWNER)}, '[]', NULL, 'in_progress'
FROM students s
WHERE NOT EXISTS (SELECT 1 FROM manual_tasks t WHERE t.request_key = {quote(KEY_PREFIX)} || s.id);
"""
        append_note_block = f"""
UPDATE manual_tasks SET
  description = 'fsd-rich-text-v1:' || json_insert(substr(description, length('fsd-rich-text-v1:') + 1), '$.content[#]', json_object('type', 'codeBlock', 'attrs', json_object('language', 'note'))),
  updated_by = {quote(OWNER)}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE inbox_owner = {quote(OWNER)} AND request_key LIKE {quote(KEY_PREFIX + '%')}
  AND description LIKE 'fsd-rich-text-v1:%' AND description NOT LIKE '%\"type\":\"codeBlock\"%';
"""
        link_students = f"""
INSERT OR IGNORE INTO task_students(task_id, student_id)
SELECT t.id, s.id FROM students s JOIN manual_tasks t ON t.request_key = {quote(KEY_PREFIX)} || s.id;
"""
        verify = f"""
SELECT changes() AS linked_in_last_statement,
  (SELECT count(*) FROM manual_tasks WHERE inbox_owner = {quote(OWNER)} AND request_key LIKE {quote(KEY_PREFIX + '%')}) AS batch_cards,
  (SELECT count(*) FROM task_students ts JOIN manual_tasks t ON t.id = ts.task_id WHERE t.inbox_owner = {quote(OWNER)} AND t.request_key LIKE {quote(KEY_PREFIX + '%')}) AS linked_students,
  (SELECT count(*) FROM manual_tasks WHERE inbox_owner = {quote(OWNER)} AND request_key LIKE {quote(KEY_PREFIX + '%')} AND description LIKE '%studentMention%' AND description LIKE '%Validate student attendance and payment coverage%' AND description LIKE '%\"type\":\"codeBlock\"%') AS checkbox_descriptions;
"""
        production_target.verify(ROOT, target)
        run(config, create_cards)
        production_target.verify(ROOT, target)
        run(config, append_note_block)
        production_target.verify(ROOT, target)
        run(config, link_students)
        production_target.verify(ROOT, target)
        result = rows(run(config, verify))[0]
        production_target.verify(ROOT, target)
        if result["batch_cards"] != check["students"] or result["linked_students"] != check["students"] or result["checkbox_descriptions"] != check["students"]:
            raise RuntimeError("Post-write verification failed: expected one card and link per student. Inspect the live batch before retrying.")
        print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
