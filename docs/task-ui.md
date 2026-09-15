# Task board

The Tasks page uses the existing `/api/tasks` backend and its configured columns.
The UI uses the approved dnd-kit React integration, sortable helpers, and DOM and
collision configuration packages, pinned to `0.5.0`. No database migration is
needed for drag-and-drop. Apply the backend's
`0055_manual_tasks.sql` and `0056_automatic_tasks.sql` through the normal environment migration workflow before
using Tasks; the UI implementation does not migrate any application database.

## Administration

The owner grants **Tasks** access on the Administrators page. Tasks appears in
navigation for administrators with that permission.

- Create, edit, or delete a manual task; only its title is required.
- Set an optional due date, description, and student relationship.
- Search the student picker by name; inactive students remain selectable.
- Open a linked student in the existing student panel. Normal modified link
  clicks still open the directory's student deep link in another tab.
- In **Student info → Linked tasks**, review every relationship, including
  completed and dismissed tasks, and explicitly remove links. Removing a link keeps the task.
  Students cannot be deleted until all task relationships have been removed.

## Views and movement

All tasks mixes manual tasks and retained automatic occurrences. Manual tasks
limits the board to manually created tasks; Student Birthdays shows birthday
occurrences. Further category views come from the backend registry.

Automatic cards have a category label and reuse the same student links, date
presentation, movement controls, and drag-and-drop. Their generated content is
read-only. Move to Done to complete an occurrence, or use Dismiss occurrence.
Include dismissed tasks reveals those cards and their Restore occurrence action.
Remove student link asks for confirmation and preserves the occurrence state.
Completion, dismissal, and unlinking affect one year only.

Opening/refreshing the board synchronizes birthday occurrences, including missed
overdue birthdays since activation. Read-only database copies show saved tasks
without synchronization or editing. Birthdays appear up to 30 days ahead; inactive
students receive no new occurrences. Existing tasks survive inactivity and removal
of a birth date. February 29 uses March 1 in non-leap years.

Date filters use Europe/Bucharest calendar dates. Next 7/30 days includes today
through today + 7/30. Overdue excludes completed and dismissed tasks; undated tasks appear only
under All dates. Completed tasks are included by default. View, date, status,
completed/dismissed visibility, and student filters are saved in the URL and support
browser Back/Forward.

The board stacks columns on mobile and uses three columns on wide screens.
Every card has a status selector and Move up/down/top/bottom buttons. Up/down
uses adjacent visible tasks; top/bottom uses the complete column, including
hidden tasks. Changing status appends to the destination column. All views share
the same saved order.

## Drag-and-drop

Drag a task by its dedicated handle. Mouse/pen movement starts after six pixels;
touch requires a 250 ms hold with a small movement tolerance. Only the handle
disables touch scrolling. Links, edit buttons, and the rest of the card keep
their usual behavior. Empty columns are drop targets. The implementation follows
the [dnd-kit multiple-list pattern](https://dndkit.com/react/guides/multiple-sortable-lists/).

Keyboard users can focus the handle, press Enter/Space, move with the arrow keys,
then press Enter/Space to drop or Escape to cancel. Screen-reader instructions
and announcements describe the operation. The status and up/down/top/bottom
controls remain available on every card, including on mobile.

Dragging shows an optimistic preview and keeps that preview while saving. A drop
is translated into a single relative move and sent through the same revision-
checked `/api/tasks/move` call as the buttons. Hidden tasks are never submitted
as a replacement list. A drop into a column with no visible tasks appends to that
complete column; other drops use visible neighboring tasks as relative anchors.

Escape, dropping outside the board, and unchanged positions make no write.
A failed save restores the previous layout and requires a refresh before another
move, including when a lost response makes the server's outcome uncertain.
Filters and other movement actions are disabled during a drag/save.

Explicit controls continue to wait for server confirmation. Editor conflicts
preserve the draft and provide the latest saved values for review before a
deliberate retry. A lost create response retains its original request and retry
key to avoid duplicate creation. Refresh failures after a save are shown without
reporting the completed save as failed.

## Verification

- `node scripts/test-task-ui.mjs`: filter combinations, calendar boundaries,
  URL serialization, card/editor/server rendering, drag-to-relative-move mapping,
  and HTTP error handling.
- `TASK_UI_CHROME=/path/to/chrome node scripts/test-task-ui-browser.mjs`:
  synthetic mouse, touch, and keyboard dragging; empty/populated columns;
  cancellation, optimistic rollback, conflicts, quick taps and mobile scrolling;
  CRUD, lost-response retries, explicit movement, focus restoration, persisted
  ordering, URL history, student-panel unlinking, desktop/mobile layout, automatic
  views/completion/dismissal/restoration/unlinking, and read-only refresh.
  Uses a temporary localhost fixture and
  an already installed Chromium; no real student data or application database.
  Without `TASK_UI_CHROME`, this optional suite reports a skip.
- Existing task API and Worker permission tests remain the backend regression
  checks. Run `npm run typecheck` and `npm run build` for the complete application.

The repository currently has no lint script or linter configuration.
