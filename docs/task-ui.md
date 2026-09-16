# Tasks workspace

The workspace has a personal **Inbox** on the left and a **School / Personal** board toggle on the right. School is shared by administrators with Tasks permission; Personal and Inbox belong only to the signed-in administrator.

## Layout and use

- **Hide Inbox / Show Inbox** toggles the personal panel and remembers the setting
  in this browser. Unsent Inbox drafts survive toggling.
- Inbox stays beside the board and has an **Add a card** input at the top.
- The page header contains the School / Personal toggle, Hide Inbox / Show Inbox,
  Change color, and an icon-only Refresh button. Each scope has one board;
  administrators create named lists within it.
- Lists stay side by side. **Add another list**, immediately after the last list,
  opens a name input, Add list, and Cancel. New lists appear before the composer.
- Each list has **Add a card**. Cards show a compact title and optional due date
  and a linked student’s profile image (initials when absent). Click the card to
  edit its full details or delete it; click the image to open the student.
- Open a card to use its List selector and Move up/down controls in the editor. There is no card ellipsis menu. Selecting a list takes effect on Save; up/down changes are saved immediately.
  Moving an Inbox card into a shared list makes it visible to other administrators.
  Moving a shared card to My Inbox makes it private to the administrator moving it.
- Lists determine the workflow. There are no task statuses or task-page filters.
- The editor uses a searchable multiselect with photos and full names to link several students. Unchecking one student leaves the others linked.
- Student photos and the bottom-right due date share a compact card footer.
- Student links open the existing student panel. Personal student relationships
  are visible only to the task owner and still prevent student deletion.
- Dates use Europe/Bucharest calendar dates. Next 7/30 days includes today.

The narrow-screen workspace scrolls horizontally between Inbox and shared board;
shared lists also scroll horizontally. Thin scrollbars keep both axes usable
without heavy tracks, and long lists scroll within their own panels. Inbox scrolls vertically independently.
Controls support keyboard and touch, with 44px action targets.

## Colors and list order

The gear at the right of every list, Inbox, and board header opens its settings.
**Change color** offers solid and gradient presets plus Default. School board/list
colors are shared. Personal board/list colors and Inbox color belong to the
signed-in administrator and persist across browsers. Cards retain readable neutral surfaces.
The color dropdown opens above scrolling panels and fits narrow screens.

Drag a list by its heading to reorder it within the current board. Inbox remains
fixed. Keyboard sorting provides the accessible alternative. Order is saved with
the same revision guard as card moves; failed saves restore the previous
arrangement and offer Refresh. Cards retain their lists and positions when a
whole list moves. List settings also provide a confirmed **Remove list** action;
move or delete its cards first.

## Drag and drop

The existing dnd-kit integration handles pointer, touch, and keyboard input.
Move the pressed card by four pixels to drag immediately, or hold it for
250 ms. Mouse, pen, and touch use the same card surface.
A quick click opens the editor. On touch screens, swipe the list background or
header to scroll; the card surface reserves touch movement for dragging. Student
links do not start drags. Keyboard: focus the card, then Enter/Space, arrows, Enter/Space to drop,
Escape to cancel. Explicit movement controls provide the same operations.

Drag previews are optimistic. Failed saves restore the prior layout and request
a refresh. Revision conflicts preserve editor drafts for review. Creation retries
retain their original request key to avoid duplicate cards or lists.
Board selection is saved in the URL.

## Setup and verification

Apply migrations through `0061_task_appearance.sql` using the normal
migration workflow. Existing manual tasks remain shared after upgrading.
No application database is migrated by UI tests.

- `node scripts/test-task-ui.mjs`
- `TASK_UI_CHROME=/path/to/chrome node scripts/test-task-ui-browser.mjs`
- `node scripts/test-task-boards.mjs`
- `node scripts/test-tasks.mjs`
- `npm run typecheck` and `npm run build`

Browser tests use synthetic data and a temporary localhost fixture. The repository
has no lint script or linter configuration.
