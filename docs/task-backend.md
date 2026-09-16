# Task backend

Tasks use the existing storage binding, administrator permissions, same-origin
JSON validation, prepared D1 statements, and guarded transactional batches.

## Storage and migration

`0055` introduced manual tasks and the Tasks permission. `0057` added shared
boards and named lists. `0058_personal_task_inboxes.sql` retires generated-task
storage and introduces private Inbox ownership. Historical migration files remain
in sequence so existing databases upgrade safely.

`0059_personal_task_boards.sql` consolidates existing shared lists into School and adds `task_boards.owner_email`. Unique indexes allow one School board and one Personal board per administrator. Ownership and list board assignment are immutable. Personal boards are created atomically with their first list, using authenticated identity. Tasks inherit list privacy. Copies insert administrator profiles before boards; imports reject conflicting board ownership or list assignments. Older exports consolidate shared lists into School.

`0060_task_student_links.sql` removes status and moves existing single-student links into `task_students(task_id, student_id)`. The composite primary key prevents duplicates; task deletion cascades link cleanup, while student deletion is restricted. Link changes invalidate the board revision and share the task write transaction. Legacy JSON imports convert single links; backups and copies include the relationship table.

`0061_task_appearance.sql` adds preset `color` keys to boards/lists and a private `task_preferences(email, inbox_color)` row per administrator. Shared School colors are visible to all Tasks administrators. Personal ownership comes from the existing board, and Inbox preference queries use authenticated email. Preference triggers invalidate the global revision. Older exports default colors; copies/backups preserve them.

A manual task has either:

- a `list_id` referencing a School or Personal list and a null `inbox_owner`; or
- a null `list_id` and a normalized authenticated administrator `inbox_owner`.

Database triggers enforce exclusive placement. Legacy inserts without placement
default to shared list 1. Existing tasks remain shared; the former default shared
Inbox board/list become School tasks / Tasks. Student profiles are preserved.

Student relationships use `ON DELETE RESTRICT`, including private
tasks. Each owner must remove their private task relationships before deleting a
linked student. The linked-task API never exposes another administrator's Inbox.

Exports, imports, copies, replacement, clear-data, and backup migration bundles
include placement and ownership. Older JSON exports are upgraded to shared list
placement; retired tables are ignored. Owner-only whole-database maintenance and
backup access retains its existing privileged scope. Clear-data recreates the
default shared board and list; personal Inboxes are empty without seeded rows.

## Authorization and privacy

Cloudflare Access provides the normalized administrator email. Every task route
requires the owner identity or `can_tasks = 1`; the Worker also protects the page
and API prefix. Private ownership always comes from that identity, never a client
email. Owners receive no special access to other Inboxes through task APIs.

All snapshots are SQL-filtered to School tasks plus the caller’s Personal board and Inbox. Direct
GET, PATCH, DELETE, relative anchors, list creation responses, student
filters, and ordering writes use that same scoped snapshot. Unavailable private
keys return 404. Movement into Inbox assigns the caller; movement into a shared
list clears private ownership. Unsupported ownership fields are rejected.

## API

| Method | Route | Request |
|---|---|---|
| GET | `/api/tasks` | Optional `studentId` query parameter |
| GET | `/api/tasks/manual:123` | None |
| POST | `/api/tasks` | `title`, optional content fields, `listId`, `revision`, `requestKey` |
| PATCH | `/api/tasks/manual:123` | `revision` and editable fields |
| DELETE | `/api/tasks/manual:123` | `revision` |
| POST | `/api/tasks/move` | `key`, optional `listId`, `position`, optional `targetKey`, `revision` |
| PATCH | `/api/tasks/appearance` | `target` (`inbox`, `board`, `list`), `color`, `revision`; board `scope` or `listId` when applicable |
| POST | `/api/tasks/lists/move` | `listId`, `targetId`, `position` (`before`, `after`), `revision` |
| DELETE | `/api/tasks/lists/:id` | `revision` |
| POST | `/api/tasks/lists` | `name`, `scope` (`school` or `personal`), `revision`, `requestKey` |

On creation, omitted/null `listId` means personal Inbox. On PATCH/move, omitted
placement preserves the current location; null selects Inbox. Lists are the workflow. Titles are trimmed and
1–200 characters; descriptions at most 10,000; due dates valid `YYYY-MM-DD` or
null; `studentIds` is a deduplicated array of existing student IDs (maximum 500); an empty array removes all links. List names are
trimmed, required, and at most 100 characters. Creation keys are 16–80 letters,
digits, or hyphens and retain the exact original request for safe retries.

The normalized response contains `tasks`, `boards`, `lists`, `views`, `today`, and `revision`. The snapshot also includes the caller’s `inboxColor` and each board/list’s color. All responses use `no-store`.

## Ordering and conflicts

All task writes check the last loaded global revision inside the D1 batch.
Concurrent changes abort stale writes. Revisions are opaque monotonic tokens.
Personal changes also invalidate the global revision; this is deliberately the
existing concurrency mechanism, not a separate subsystem per Inbox.

Moves use top/bottom or before/after an accessible task in the destination.
The server retains hidden tasks and reindexes only the destination list or the
caller's Inbox. JSON chunks of 500 rows avoid a prepared query per reordered task.
Content changes preserve position; placement changes append by default.

List moves reject cross-board targets and reindex only the source board. They do not update cards. Both appearance and list ordering use guarded D1 batches and the same scoped permission checks.

## Verification

`test-task-boards.mjs` covers multi-administrator isolation, direct access,
publication/private moves, ordering, retries, copies, and old exports.
`test-personal-task-migration.py` checks upgrade preservation and placement
constraints. The existing CRUD, UI, browser, Worker permissions, copy, backup,
and schema parity checks remain relevant. Run type checking and a production
build. No new dependency is required.
