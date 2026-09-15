-- Manual-task foundation. Automatic rules and their occurrence storage follow
-- in a separate phase; no student records are changed by this migration.
ALTER TABLE administrator_permissions ADD COLUMN can_tasks INTEGER NOT NULL DEFAULT 0
  CHECK (can_tasks IN (0, 1));

CREATE TABLE task_board_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0)
);
INSERT INTO task_board_state (id, revision) VALUES (1, 0);

-- Set the supplied expected revision + 1, not revision = revision + 1 with a
-- WHERE predicate: a stale write must abort its entire batch, not match no rows.
CREATE TRIGGER task_board_revision_matches BEFORE UPDATE OF revision ON task_board_state
WHEN NEW.revision != OLD.revision + 1
BEGIN SELECT RAISE(ABORT, 'Task board changed. Reload before saving.'); END;

CREATE TABLE manual_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  due_date TEXT CHECK (due_date IS NULL OR (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(due_date, '+0 days') IS NOT NULL AND date(due_date, '+0 days') = due_date)),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  student_id INTEGER REFERENCES students(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0),
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  updated_at TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_payload TEXT NOT NULL
);
CREATE INDEX manual_tasks_order_idx ON manual_tasks (status, sort_order, id);
CREATE INDEX manual_tasks_due_idx ON manual_tasks (due_date, status);
CREATE INDEX manual_tasks_student_idx ON manual_tasks (student_id);

-- Include import/clear operations in revision invalidation, not just task APIs.
CREATE TRIGGER manual_tasks_insert_revision AFTER INSERT ON manual_tasks
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER manual_tasks_update_revision AFTER UPDATE ON manual_tasks
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER manual_tasks_delete_revision AFTER DELETE ON manual_tasks
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
