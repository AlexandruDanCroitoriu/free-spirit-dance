-- Preserve all existing shared lists/cards in one School board.
CREATE TABLE _task_list_positions (id INTEGER PRIMARY KEY, position INTEGER NOT NULL);
INSERT INTO _task_list_positions SELECT id, row_number() OVER (ORDER BY board_id, sort_order, id) - 1 FROM task_lists;
UPDATE task_lists SET sort_order = (SELECT position FROM _task_list_positions WHERE id = task_lists.id);
DROP TABLE _task_list_positions;
UPDATE task_lists SET board_id = 1;
DELETE FROM task_boards WHERE id != 1;
UPDATE task_boards SET name = 'School', request_key = NULL WHERE id = 1;
ALTER TABLE task_boards ADD COLUMN owner_email TEXT COLLATE NOCASE REFERENCES admin_profiles(email)
  CHECK (owner_email IS NULL OR length(trim(owner_email)) > 0);
CREATE UNIQUE INDEX task_boards_personal_owner_idx ON task_boards(owner_email);
CREATE UNIQUE INDEX task_boards_single_school_idx ON task_boards((1)) WHERE owner_email IS NULL;
-- Placement changes happen on the task, never by changing a list's privacy.
CREATE TRIGGER task_board_owner_immutable BEFORE UPDATE OF owner_email ON task_boards
WHEN NEW.owner_email IS NOT OLD.owner_email
BEGIN SELECT RAISE(ABORT, 'Task board ownership cannot change.'); END;
CREATE TRIGGER task_list_board_immutable BEFORE UPDATE OF board_id ON task_lists
WHEN NEW.board_id != OLD.board_id
BEGIN SELECT RAISE(ABORT, 'A task list cannot change boards.'); END;
