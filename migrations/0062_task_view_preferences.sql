-- Per-administrator task view preferences. Inbox dimensions stay browser-local.
ALTER TABLE task_preferences ADD COLUMN selected_board_scope TEXT NOT NULL DEFAULT 'school'
  CHECK(selected_board_scope IN ('school', 'personal'));
