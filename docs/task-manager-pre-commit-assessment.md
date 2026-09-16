# Historical task review notes

The implementation has since changed to private Inboxes and shared boards.
Findings concerning removed functionality have been retired. These notes are
not a current pre-commit assessment. The current card layout permits student
navigation in read-only mode, and the latest browser run passed touch checks;
the observations below describe the earlier implementation.

### L1 — Read-only mode also blocks student navigation

**Locations:** `app/components/task-board.tsx:89`, `app/components/task-card.tsx:23`.

The same `disabled` flag controls mutations and student links. Consequently, administrators cannot open linked students from a read-only task board, although navigation does not modify data.

### L2 — Touch-drag verification is intermittent

**Location:** `scripts/test-task-ui-browser.mjs:166`.

The first browser run timed out waiting for touch-drag activation; an unchanged retry passed. This does not establish a product defect, but the touch acceptance test is not reliably green. The failure needs investigation before treating mobile drag behavior as fully verified.
