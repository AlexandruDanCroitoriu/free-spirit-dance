-- Retire generated task storage. Manual tasks and student profiles are preserved.
DROP TRIGGER task_student_insert_revision;
DROP TRIGGER task_student_delete_revision;
DROP TRIGGER task_student_update_revision;
DROP TABLE automatic_task_occurrences;
DROP TABLE task_rule_state;

-- A task belongs either to a shared list or to one administrator's private Inbox.
DROP TRIGGER manual_task_default_list;
DROP TRIGGER manual_task_required_list;
ALTER TABLE manual_tasks ADD COLUMN inbox_owner TEXT COLLATE NOCASE REFERENCES admin_profiles(email)
  CHECK (inbox_owner IS NULL OR (length(trim(inbox_owner)) > 0 AND inbox_owner = lower(trim(inbox_owner))));
CREATE TRIGGER manual_task_placement_insert BEFORE INSERT ON manual_tasks
WHEN NEW.list_id IS NOT NULL AND NEW.inbox_owner IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Choose a shared list or a personal Inbox.'); END;
CREATE TRIGGER manual_task_shared_default AFTER INSERT ON manual_tasks
WHEN NEW.list_id IS NULL AND NEW.inbox_owner IS NULL
BEGIN UPDATE manual_tasks SET list_id = 1 WHERE id = NEW.id; END;
CREATE TRIGGER manual_task_placement_update BEFORE UPDATE OF list_id, inbox_owner ON manual_tasks
WHEN (NEW.list_id IS NULL) = (NEW.inbox_owner IS NULL)
BEGIN SELECT RAISE(ABORT, 'Choose a shared list or a personal Inbox.'); END;
CREATE INDEX manual_tasks_inbox_order_idx ON manual_tasks(inbox_owner, sort_order, id);
-- Existing shared work must never be assigned to an arbitrary administrator.
UPDATE task_boards SET name = 'School tasks' WHERE id = 1 AND name = 'Inbox';
UPDATE task_lists SET name = 'Tasks' WHERE id = 1 AND name = 'Inbox';
UPDATE task_board_state SET revision = revision + 1 WHERE id = 1;
