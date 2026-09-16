# Task workspace design

Current direction: a private Inbox for each administrator, alongside School / Personal boards containing administrator-created lists. The reference layout has a
tall Inbox on the left, a shared board header on the right, horizontal lists,
compact cards, and an inline Add another list composer.

Use the existing Tasks permission, storage binding, task CRUD, revision guards,
student panel, dialog editor, and dnd-kit integration. Enforce Inbox and Personal board ownership
in backend queries and all mutations. Shared tasks remain visible to every
administrator with Tasks access. Persist ordering within shared lists and each
personal Inbox. The editor provides list selection and up/down controls alongside dragging.

Migration 0058 preserves manual tasks as shared work, retires generated-task
storage, and adds private ownership. Imports, exports, copies, and backups must
retain ownership and accept older exports safely. Preserve student data and
restrict deletion while task relationships exist.

Migration 0059 consolidates existing shared lists into School without deleting cards, adds immutable personal board ownership, and permits one board per administrator. Personal boards are created lazily with their first list.

Migration 0060 removes statuses and preserves existing student links in a many-to-many table. The editor links multiple students through one searchable photo/name picker. Cards place due dates at bottom-right alongside student photos.

Migration 0061 persists board/list color presets and private Inbox color. Lists reorder within their board through dnd-kit header dragging, keyboard controls, or settings-menu left/right actions; card placements do not change.

See [UI behavior](task-ui.md) and [backend design](task-backend.md). Verify with
multi-administrator privacy tests, migration preservation tests, task CRUD and
ordering tests, browser interactions, type checking, and a production build.
