# Task backend

This phase implements manual tasks and shared board state. Automatic rules,
automatic occurrence tables, the Tasks page, and drag-and-drop remain for later
phases of [the approved plan](task-management-plan.md).

## Migration and storage

Apply `0055_manual_tasks.sql` through the existing migration workflow before
deploying this backend. It adds `manual_tasks`, `task_board_state`, and
`administrator_permissions.can_tasks`. Existing student records are unchanged.
The migration has not been applied to Catalog or production as part of development.

Use `app/lib/storage.ts` for all task access. Catalog, production, and working
copies have independent task records. Existing maintenance, read-only, and
database-generation guards continue to apply.

Task student links use `ON DELETE RESTRICT`. Even a Done task prevents student
deletion until its link is explicitly removed or the task is deleted. Existing
attendance/payment restrictions still apply. A failed student deletion leaves
its image intact.

Full exports include task data. Copy/replacement operations preserve task
content, IDs, links, ordering, and attribution. Board revisions are concurrency
tokens local to the destination: replacements advance the destination revision
rather than copying an older source token. SQL backups retain their full schema
and state. Additive imports accept pre-task exports, preserve destination tasks,
and map task links to newly generated student IDs.

## Authorization

Cloudflare Access supplies the authenticated administrator email. Tasks require
the owner identity or `can_tasks = 1`; new ordinary administrators default to no
task access. Both `/tasks` and `/api/tasks/*` are protected at the Worker boundary,
and task handlers check permission before reading task records or processing writes.
Plain localhost follows the app's development-owner convention.

The existing owner-only administrator PATCH API accepts an optional boolean
`tasks` alongside its existing required permission fields. Omitting `tasks`
preserves the existing grant, so the current administrator UI remains compatible.
The Administrators page exposes the Tasks permission checkbox.

Mutations require same-origin JSON requests. Task input is bounded to 64 KiB.
All responses use `Cache-Control: no-store`.

## API

| Method and route | Request | Response |
|---|---|---|
| `GET /api/tasks` | Optional `studentId` query parameter | `{ tasks, revision, today, columns, views }` |
| `GET /api/tasks/manual:123` | None | `{ task, revision }` |
| `POST /api/tasks` | `title`, optional fields below, `revision`, `requestKey` | `{ task, revision }` (201; 200 for a confirmed retry) |
| `PATCH /api/tasks/manual:123` | `revision` and at least one editable field | `{ task, revision }` |
| `DELETE /api/tasks/manual:123` | `{ revision }` | `{ deleted: true, revision }` |
| `POST /api/tasks/move` | `{ key, status, position, targetKey?, revision }` | Updated board |

Editable fields:

- `title`: trimmed, required, 1–200 characters.
- `description`: optional, default empty, up to 10,000 characters.
- `dueDate`: valid `YYYY-MM-DD`, or `null`/empty to clear; past dates allowed.
- `status`: `todo` (default), `in_progress`, or `done`.
- `studentId`: positive integer for an existing student, or `null` to unlink.

PATCH preserves unspecified fields. Content is plain text. Unsupported fields,
including client-supplied ordering and automatic-source attributes, are rejected.
Creation keys contain 16–80 letters, digits, or hyphens; a UUID is suitable.
Reusing a key with the same original details confirms the existing task without
creating another. Reusing it with different details returns 409. After a network
failure, retry creation with the same key and original details.

Task responses use the shared `BoardTask` type from `app/lib/tasks.ts`, including
source/category, student summary, supported actions, and attribution. Manual
responses have `source: "manual"`, `category: "manual"`, and
`dismissed: false`. `today` uses Europe/Bucharest. The complete board is returned;
date/category filtering uses the common representation in the UI.

## Ordering and conflicts

New tasks and status changes through PATCH append to their destination column.
Use the move endpoint for explicit placement:

- `position: "top"` or `"bottom"` with no target.
- `position: "before"` or `"after"` with `targetKey` in the destination column.

These intents support drag/drop as well as mobile and keyboard controls. The
server reads the complete column, retaining hidden tasks' relative order. It
reindexes the affected destination column; gaps in the source column are harmless.
Equal imported positions are ordered deterministically by task ID.

Every mutation requires the last loaded board revision. A database trigger checks
the supplied revision before any mutation in the batch, aborting stale writes.
Task insert/update/delete triggers also advance the revision for import and
clear-data operations. Revisions are opaque monotonic tokens; clients must use
the returned value rather than assuming they increase by exactly one.

On 409, reload the board, retain the administrator's draft, and retry deliberately.
Do not automatically overwrite a newer administrator change. Movement responses
can replace the client's full board after saving; filtered lists must never be
submitted as the full column order.

## Verification

- `node scripts/test-tasks.mjs`: synthetic SQLite API, validation, authorization,
  concurrency, relationship, import/export, and clear-data tests.
- `python3 scripts/test-task-migration.py`: upgrade preservation, database
  constraints, and restrictive student relationships in every task status.
- `node --test tests/worker-permissions.test.mjs`: Worker authorization boundary.
- `node scripts/test-local-copies.mjs`: local copies and replacement path using
  synthetic databases, including linked tasks.
- `node scripts/test-backup-migrations.mjs`: restore upgrades and rollback.
- `python3 scripts/validate-schema.py`: independent static schema-diagram parity.
- `npm run typecheck` and `npm run build`.

No new dependency was added. The repository currently has no lint script or
linter configuration.

## Automatic rules and occurrence state

Migration `0056_automatic_tasks.sql` adds `task_rule_state` and
`automatic_task_occurrences`, plus indexes and revision triggers. It leaves
existing students and manual tasks unchanged and does not activate or generate
birthdays during migration. The migration bundle and schema diagram include it.
Apply it through the normal migration workflow before using the updated app.

- `app/lib/task-rules.ts` contains the pure evaluator and code-defined registry.
- `app/lib/task-rules/birthdays.ts` defines birthday eligibility and identity.
- `app/lib/task-rules-server.ts` commits evaluations/checkpoints and coordinates
  student mutations using the same prepared SQL and guarded D1 batches as tasks.
- `app/lib/task-dates.ts` shares calendar arithmetic with birthday notifications.

A rule returns candidates with `(ruleKey, subjectKey, occurrenceKey)`. Normalized
keys encode those parts, for example `automatic:birthday:student%3A123:2027`.
The database enforces uniqueness independently of its internal row IDs.
`retention: 'occurrence'` preserves an eligible event even after the condition
stops matching; `retention: 'state'` calculates candidates and stores a row only
when an administrator acts or persisted ordering needs it. A test-only second
rule verifies the latter path. Birthday is the only enabled production rule.

`POST /api/tasks/refresh` accepts `{}` with the normal Tasks permission, origin,
and JSON checks. It activates registered rules on first use and catches up from
the last successful school date. Both GET endpoints remain read-only. The board
synchronizes on opening, explicit refresh, student-panel updates, and a detected
school-date change. Read-only copies load saved state without posting refresh.
There is no cron job: missed occurrences appear on the next synchronization.

Birthdays enter from today through today + 30 inclusive, using Europe/Bucharest.
Calendar arithmetic is independent of browser timezone and daylight saving.
January dates correctly belong to the next occurrence year when viewed in
December. February 29 uses March 1 in non-leap years.

Because unfinished birthdays must remain overdue, eligible birthday occurrences
are retained. No pre-activation backlog or arbitrary future yearly rows are
created. Completion/dismissal applies to one student/year. A later year has a new
identity. Inactive students receive no new occurrences. Existing links and
unfinished occurrences remain; correcting a birth date updates unfinished due
dates while completed/dismissed occurrences retain their saved dates. Removing
a birth date stops future detection and keeps retained tasks.

Student create/update/delete routes reconcile prior eligibility and apply the
student mutation in one guarded batch. New and reactivated students use current
eligibility rather than invented historical activity. A failed synchronization
rolls back the student change and evaluation progress. Source-field revision
triggers invalidate concurrent evaluations; refresh retries a stale snapshot up
to twice. Explicit administrator edits/moves still return 409 for review.

Automatic tasks use the existing GET/PATCH/move endpoints. PATCH permits status,
`dismissed: boolean`, and `studentId: null`; content editing, reassignment, and
DELETE are rejected. Unlinking keeps a suppression marker and never recreates
that occurrence's relationship. All links, including done/dismissed ones, block
student deletion until explicitly removed. A subsequent year remains eligible
while the student still exists and is active.

Manual and automatic tasks share one column order and revision. Catch-up and
reindex writes use JSON batches of up to 500 entries, avoiding a query/binding
per retained row. A 600-task test covers multiple batches and unique ordering.
Checkpoints and all writes remain atomic.

Exports, local copies, replacements, clear-data, and backups include both new
tables. Additive imports preserve destination activation/progress, accept older
exports without automatic tables, remap temporary student IDs in birthday
identities and links, and seal previous eligibility before importing students.
They retain the existing import API's partial-import behavior on errors.

To add a rule, define its stable occurrence identity, eligibility, retention
policy, and optional content refresh/subject-ID remapping in the registry. Add
source data/lifecycle integration and tests when that rule needs them. Category
views come from the registry; no new Kanban or filter implementation is required.

Additional checks:

- `node scripts/test-automatic-tasks.mjs`: pure rules, calendar/year boundaries,
  yearly recurrence, overdue catch-up, student lifecycle, sparse state, mixed
  ordering, transactional failures/concurrency, imports, copies, and clear-data.
- `python3 scripts/test-automatic-task-migration.py`: upgrade preservation,
  occurrence uniqueness, constraints, revisions, and restrictive relationships.
