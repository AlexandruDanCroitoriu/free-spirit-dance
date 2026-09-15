# Task management implementation plan

Status: Approved for implementation by the user on 2026-09-15.

Prepared: 2026-09-15

## 1. Architecture and agreed behavior

Student deletion must be blocked while any task relationship exists, including completed and dismissed tasks. Relationships must be explicitly removed first. This supersedes the earlier proposal to clear links automatically during deletion.

The repository, storage routing, student deletion, permissions, ordering, import/export, backup handling, and test infrastructure were re-checked while preparing this plan.

### Reuse the existing application structure

Continue with:

- Vinext pages and React client components.
- API route handlers under `app/api/`.
- Prepared SQL through request-scoped `app/lib/storage.ts`.
- D1 batches for related writes.
- Existing administrator permission management.
- Existing `StudentPanel`, Tailwind styling, native controls, and operation notifications.
- Existing Node/SQLite tests and production build checks.

No ORM, separate backend, global state library, or background service is needed.

The existing database-switching and backup protections must apply to every task operation. Task state belongs to the selected database.

### Confirmed behavior

- One shared school board.
- Owner-controlled Tasks permission, enforced on the page and task APIs.
- Todo, In Progress, and Done columns.
- Manual tasks support creation, editing, deletion, and optional student links.
- Automatic tasks share the same cards, columns, filters, and movement controls.
- Birthday occurrences enter the board within 30 days of their due date.
- Unfinished birthdays remain overdue.
- Student deactivation preserves existing occurrences and stops future generation.
- Birth-date corrections update unfinished occurrences; completed/dismissed occurrences remain resolved for that year.
- Completing 2026 does not suppress 2027.

## 2. Database design

Use one additive migration, provisionally `0055_tasks.sql`, after the current `0054`. Reconfirm numbering before implementation.

| Table/change | Contents and purpose |
|---|---|
| `manual_tasks` | ID, title, description, nullable due date, status, nullable student FK, sort order, timestamps, administrator attribution, creation retry key. |
| `automatic_task_occurrences` | ID, rule key, stable subject key, occurrence key, nullable student FK, retained display/due-date information, status, dismissal/unlink state, sort order, timestamps and attribution. |
| `task_rule_state` | Rule key, activation date, last successful evaluation date. Supports catch-up without generating historical backlog from before activation. |
| `task_board_state` | One row containing a board revision for atomic conflict detection. |
| `administrator_permissions.can_tasks` | Boolean permission, disabled by default for ordinary administrators. Owner access remains automatic. |

### Constraints

- `status` restricted to `todo`, `in_progress`, and `done`.
- Required, bounded title; bounded description.
- Calendar dates stored as `YYYY-MM-DD`; timestamps stored consistently with existing APIs.
- Unique automatic identity: `(rule_key, subject_key, occurrence_key)`.
- Indexed student links, due dates, and status/order.
- Student foreign keys use `ON DELETE RESTRICT`.
- A database-enforced revision guard aborts conflicting mutation batches.

D1 supports restrictive foreign keys and prepared-statement batches, fitting the existing storage approach. See [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) and [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

### Future automatic types

Rule and occurrence keys are text identifiers, not birthday-only columns or fixed database enums.

Examples:

```text
birthday / student:123 / 2026
payment-overdue / payment:456 / occurrence-specific-key
```

Each future rule defines when a condition represents a new occurrence. This is essential for conditions that resolve and later return.

Persisted automatic rows serve two purposes:

- Retained occurrences where lifecycle requires persistence, as birthdays do.
- Sparse administrator state for otherwise calculated tasks.

Future transient rules need not create a row for every detected condition. Additional source-specific relationships can be added when a rule actually needs them; speculative subscription/payment schemas are unnecessary.

## 3. Student relationship lifecycle

### Deletion protection

Update `app/api/students/[id]/route.ts` to:

- Return a clear `409` when task links prevent deletion.
- Preserve existing attendance/payment restrictions.
- Keep the database foreign key as the final protection against concurrent linking.
- Delete the student image only after successful student deletion.

Completion and dismissal do not remove relationships.

### Explicit unlinking

- Manual task: remove/change its student link, or delete the task.
- Automatic occurrence: explicitly remove its student link while retaining occurrence state.
- Refresh must respect explicit unlinking and must not recreate that occurrence's relationship.
- Retained occurrence identity acts only as a deduplication/suppression marker after unlinking; it must not be used to silently restore a live association.
- Future years remain independent while the student exists and remains eligible.

Expose linked tasks from the student panel, including completed and dismissed ones, so administrators can find every relationship blocking deletion. Reuse the task API and task presentation components.

Administrators without Tasks permission receive a deletion explanation but cannot inspect or remove task relationships through an unprotected endpoint.

## 4. Shared board, ordering, and filters

### Common representation

Normalize both sources into `BoardTask`, containing:

- Stable key, source, and category.
- Title, description, due date.
- Status and ordering.
- Optional linked student.
- Dismissal state.
- Supported actions, such as content editing, deletion, and unlinking.

Use one board, card, filter implementation, and movement operation. Automatic content is generated; manual content is editable.

### Ordering and concurrent changes

Use the existing integer ordering pattern, strengthened for a shared board:

1. Client sends task key, destination column, relative target, and expected revision.
2. Server resolves the move against the complete column, including filtered-out tasks.
3. Server updates status, affected positions, and revision in one guarded batch.
4. A stale revision aborts the whole operation and returns `409`.
5. Client restores the previous visual order and preserves unsaved editor content.

Reads must return a coherent task list and revision. A revision update affecting zero rows must never allow subsequent mutations to proceed.

Views share one order. Reordering in “Student birthdays” affects the same board as “All tasks”; hidden tasks retain their relative order.

Tradeoff: one board revision may reject simultaneous unrelated changes. This is simpler and appropriate for the school's shared administrative workload.

### Views and filters

- Views: All tasks, Manual tasks, Student birthdays; later categories come from the rule registry.
- Due filters: All, Overdue, Due today, Next 7 days, Next 30 days.
- Include/exclude completed.
- Status selection.
- Separate dismissed-task visibility and restore controls.
- Optional student filter for relationship management.

Use Europe/Bucharest calendar dates consistently.

Defaults submitted with this plan:

- Date ranges include today through today + N days.
- Overdue means unfinished and due before today.
- Undated tasks appear under All.
- Completed tasks initially included; dismissed tasks initially hidden.
- Manual description and due date are optional.
- February 29 uses March 1 in non-leap years.
- Removing a birth date stops future generation but preserves retained occurrences.
- Filters/view selection are retained in URL parameters.

## 5. Automatic evaluation

Use ordinary TypeScript functions and a small code-defined registry.

Birthday identity is stable per student/year:

```text
birthday / student:123 / 2026
birthday / student:123 / 2027
```

### Synchronization

- Activate birthdays when birthday functionality is first used.
- Initially generate today through 30 days ahead.
- Record successful evaluation progress.
- On subsequent synchronization, catch up missed eligible birthdays, including those already overdue.
- Never generate pre-activation backlog.
- Persist each eligible birthday occurrence only once.
- Never overwrite completion, dismissal, explicit unlinking, or administrator ordering during refresh.

Use an idempotent `POST /api/tasks/refresh`; `GET` remains read-only. Synchronize on board opening, relevant date changes, and explicit refresh. Read-only backups show saved state without synchronization writes.

### Student mutations

Integrate with existing student create/update operations:

- Before changing active status or birth date, reconcile eligibility under the previous data.
- Apply relevant student changes and occurrence updates atomically.
- Check newly eligible upcoming birthdays after creation/reactivation.
- Do not invent historical eligibility for newly entered birth dates.
- Include the relevant bulk-import paths so they cannot invalidate evaluation progress.

Tradeoff: this modest integration with student writes is necessary to preserve occurrences even when nobody opened Tasks before a student changed.

## 6. Implementation phases

Each phase includes its own verification and leaves the application usable. New navigation appears only when its corresponding page works.

### Phase 0 — Restore a trustworthy verification baseline

#### Files likely to change

- `README.md`
- `docs/database.drawio`
- `scripts/validate-schema.py`, only if needed to restore its intended contract.

#### Database changes

- None.

#### Behavior added

- None.
- Resolve the existing missing `docs/database.drawio` reference. Preserve an independent schema-parity check; do not replace it with a self-comparison against migrations.

#### Tests required

- Existing schema validation, type checking, tests, and build.
- Record and resolve relevant pre-existing verification failures.

#### Completion criteria

- Schema documentation and validation agree.
- The existing application has an understood, passing baseline before feature changes.

### Phase 1 — Add schema and preserve database operations

#### Files likely to change

- `migrations/0055_tasks.sql`
- Schema documentation.
- `app/api/administrators/export/route.ts`
- `app/api/administrators/import/route.ts`
- `app/api/administrators/clear-data/route.ts`
- `app/lib/local-database-transfer.ts`
- Generated backup migration bundle through its existing generator.
- Migration, copy, and backup tests.

#### Database changes

- Four task tables.
- Tasks permission column.
- Constraints, indexes, restrictive student foreign keys, revision guard.
- No automatic occurrence generation yet.

#### Behavior added

- Full exports, copies, and backups preserve task data.
- Replacement/clear-data operations remove task relationships before students, within their existing operation scope.
- Older exports without task tables remain readable through explicit compatibility handling.
- Additive imports preserve destination rule progress and invalidate board revision.
- Imported occurrence identities and student links remain consistent when IDs are remapped.

#### Tests required

- Fresh migration and upgrade from `0054`.
- Preservation of existing student/payment/attendance data.
- Foreign-key restrictions and invalid-data rejection.
- Copy/export/import round trips.
- Unlink markers, occurrence identities, ordering, and permission preservation.
- Restore migration and clear-data ordering.

#### Completion criteria

- Existing screens still work.
- Database-management features handle every new table.
- No existing data is rewritten unnecessarily.

### Phase 2 — Implement protected task APIs

#### Files likely to change

- `app/lib/tasks.ts`
- `app/lib/tasks-server.ts`
- `app/api/tasks/route.ts`
- `app/api/tasks/[key]/route.ts`
- `app/api/tasks/move/route.ts`
- `worker.ts`
- Access-permission and administrator API routes.
- `app/administrators/page.tsx`
- `app/api/students/[id]/route.ts`
- API and permission tests.

#### Database changes

- None beyond Phase 1.
- New tables begin receiving manual tasks and board revisions.

#### Behavior added

- Owner-controlled Tasks permission.
- Protected manual CRUD, linking/unlinking, completion, and movement.
- Shared normalized response contract.
- Atomic ordering and conflict detection.
- Retry-safe manual creation.
- Correct task-related student deletion errors.
- Existing origin, storage-generation, maintenance, and read-only restrictions.

#### Tests required

- CRUD and validation.
- Owner, permitted administrator, denied administrator, and local identity cases.
- Direct API access denial.
- Duplicate creation retries.
- Ordering under filters and concurrent changes.
- Batch rollback.
- Student deletion blocked by tasks in every status.
- Deletion succeeds after unlinking when no other restrictions remain.
- Concurrent link-versus-delete behavior; image preservation on failure.

#### Completion criteria

- APIs are complete and protected.
- Task operations respect selected storage.
- No task page/navigation is exposed prematurely.

### Phase 3 — Deliver the manual board with accessible controls

#### Files likely to change

- `app/tasks/page.tsx`
- `app/components/task-board.tsx`
- `app/components/task-card.tsx`
- `app/components/task-panel.tsx`
- `app/components/task-filters.tsx`
- `app/components/student-tasks.tsx`
- `app/components/student-panel.tsx`
- `app/components/app-shell.tsx`
- Rendering and interaction tests.

#### Database changes

- None.

#### Behavior added

- Tasks navigation and manual-task editor.
- Responsive three-column board.
- Views, date/status filters, completed visibility.
- Explicit status selector and Move up/down/top/bottom controls.
- Student picker and existing student-panel integration.
- Student relationship list with explicit unlink actions.
- Loading, empty, error, saving, and conflict states.

#### Tests required

- Manual create/edit/delete flows.
- Filter combinations and date boundaries.
- Keyboard-only movement and editor use.
- Focus restoration and dialog behavior.
- Mobile layout and touch-target verification.
- Linked-student updates reflected in tasks.
- Hidden completed/dismissed relationships still discoverable.

#### Completion criteria

- Manual task management is fully usable on desktop and mobile without dragging.
- Every movement operation persists after reload.
- Student deletion protection has a usable relationship-removal workflow.

### Phase 4 — Add birthday occurrences and future-rule support

#### Files likely to change

- `app/lib/task-rules.ts`
- `app/lib/task-rules/birthdays.ts`
- Shared calendar-date helpers.
- `app/lib/tasks-server.ts`
- `app/api/tasks/refresh/route.ts`
- Student create/update routes.
- Relevant import paths.
- `app/components/birthday-notifications.tsx`
- Existing task components for automatic actions/category labels.
- Birthday lifecycle tests.

#### Database changes

- No new migration expected.
- Activate birthday rule state and create eligible occurrence rows.

#### Behavior added

- Birthday view and mixed manual/automatic board.
- Occurrence-specific completion, dismissal, restoration, and unlinking.
- Missed-evaluation catch-up.
- Active-state and birth-date correction handling.
- Shared calendar calculations with existing birthday notifications.
- Future rules can return calculated candidates and persist only necessary state.

#### Tests required

- Exactly one occurrence per student/year.
- 2026 completion does not suppress 2027.
- Today/+30-day boundaries, year rollover, leap years, and Bucharest timezone.
- Overdue retention after long periods without app use.
- Inactivation/reactivation and birth-date changes.
- Newly entered birth dates produce no invented historical backlog.
- Unlinking survives refresh without relinking.
- Concurrent refreshes and student mutations.
- Read-only refresh prevention.
- A synthetic second rule proves category extensibility and shared normalization without permanent rows on simple reads.

#### Completion criteria

- All agreed birthday lifecycle rules hold.
- Automatic and manual tasks use the same board/filter/movement components.
- Failed synchronization never advances its progress marker.

### Phase 5 — Add drag-and-drop as another movement interface

#### Files likely to change

- `package.json`, `package-lock.json`
- `app/components/task-board.tsx`
- `app/components/task-card.tsx`
- Small drag-specific component/helper if needed.
- Interaction tests.

#### Database changes

- None.

#### Behavior added

- dnd-kit dragging within and between columns.
- Empty-column drop targets.
- Dedicated drag handles, cancellation, and clear feedback.
- Successful drops call the same movement operation as explicit controls.

Recommend the current `@dnd-kit/react` integration and documented sortable helpers; the repository has no existing drag-and-drop dependency. Pin compatible versions and verify them with React 19/Vinext. See the [dnd-kit quickstart](https://dndkit.com/react/quickstart/).

#### Tests required

- Within-column, cross-column, and empty-column drops.
- Cancellation leaves storage unchanged.
- Failed/stale saves restore the previous layout.
- Drag handles do not interfere with links, buttons, or touch scrolling.
- Keyboard support and announcements.
- Equivalent final state from dragging and explicit controls.
- Production rendering/hydration and browser verification.

#### Completion criteria

- Dragging works reliably.
- Every drag operation has an accessible/mobile alternative.
- No persistence logic is duplicated in drag handlers.

### Phase 6 — Final integration and release readiness

#### Files likely to change

- Relevant tests and any files requiring integration fixes.
- `README.md` and task/schema documentation.
- Backup/copy tests where additional coverage is needed.

#### Database changes

- None expected.

#### Behavior added

- Final refinements discovered through complete workflow testing.

#### Tests required

- Full `npm run verify`, including `npm run build`.
- Desktop and mobile end-to-end workflows.
- Permission revocation and direct API access.
- Database switching with an open editor.
- Read-only backup behavior.
- Copy/restore preservation of completed, dismissed, overdue, and unlinked occurrences.
- Regression checks for student profiles, images, attendance, and payments.

Use synthetic databases and existing test infrastructure. Historical reconciliation and validation remain restricted to the dedicated local Catalog; no production data is needed for feature testing.

#### Completion criteria

- All automated checks pass.
- Browser acceptance checks pass.
- Migration order and deployment prerequisites are documented.
- No unresolved data-preservation, permission, ordering, or accessibility defects.

## 7. Approval scope

This plan includes the explicit student-deletion restriction and all previously confirmed lifecycle rules. The defaults listed above are submitted as part of the plan.

The user explicitly approved this final plan on 2026-09-15. Implementation may proceed according to the phases above.
