# Deployed database comparison

Initial inspection of `free-spirit-dance-db` on 2026-09-09 used read-only schema, migration history, and aggregate count queries. The findings below describe the database before cleanup. Cleanup was subsequently authorized and completed as recorded below.

The five tables in `database.drawio` match repository migrations 0001–0014, except that deployed `administrator_permissions` also has `can_subscriptions INTEGER NOT NULL DEFAULT 0 CHECK (can_subscriptions IN (0, 1))`. No administrators currently have this permission enabled. All expected indexes match.

Production also records applied migrations `0015_subscriptions_attendance.sql`, `0016_subscription_permissions.sql`, and `0017_remove_student_subscriptions.sql`, which are absent from the current repository.

## Additional tables

| Table | Records at inspection |
| --- | ---: |
| attendance | 2 |
| couple_purchases | 1 |
| course_occurrences | 8 |
| subscription_courses | 3 |
| subscription_coverage | 8 |
| subscription_pauses | 0 |
| subscription_revision | 1 |
| subscription_types | 5 |
| subscriptions | 3 |

These tables contain foreign keys to students, courses, and one another. Production also has indexes `coverage_subscription`, `occurrences_date`, and `subscriptions_student`, plus triggers `courses_subscription_delete`, `courses_subscription_insert`, `courses_subscription_update`, and `protect_course_schedule`. The latter prevents schedule changes for courses with experimental history.

## Completed cleanup

On 2026-09-09, after explicit authorization to delete records outside the diagram, migration `0018_remove_experimental_subscription_schema.sql` was applied to production successfully.

- Removed all nine experimental tables and their records, three related indexes, and four related triggers.
- Removed `administrator_permissions.can_subscriptions` by rebuilding the table with its six retained columns.
- Preserved all values in the five application tables: 2 students, 3 courses, 3 QR codes, 3 admin profiles, and 4 administrator permission records.
- Retained D1/SQLite system tables and migration history, including previously applied migrations 0015–0017.

A complete backup was saved to `.wrangler/backups/before-diagram-cleanup.sql` before migration. The post-cleanup export is `.wrangler/backups/after-diagram-cleanup.sql`. These contain private records, are excluded from Git, and have owner-only file permissions. They are local recovery copies, not off-machine archives.

## Validation

The backup restored successfully to an in-memory SQLite database. The cleanup was tested against that restored backup and against a fresh database created from repository migrations before production execution.

After production execution, the exported database's complete application schema (tables, indexes, triggers, and constraints) matched the expected repository schema. Every retained field value matched the pre-cleanup backup. SQLite integrity and foreign-key checks passed, and D1 recorded migration 0018 as applied. `npm run build` passed.

The existing Draw.io diagram remains accurate: five application tables, 47 columns, no enforced foreign-key relationships. No application deployment was needed for this database cleanup.
