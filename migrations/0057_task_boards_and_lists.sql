-- List placement is independent from completion status. Existing work stays in
-- Inbox, with populated legacy columns retained as named lists.
CREATE TABLE task_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  request_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE task_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES task_boards(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  sort_order INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0),
  request_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO task_boards(id, name) VALUES (1, 'Inbox');
INSERT INTO task_lists(id, board_id, name, sort_order) VALUES (1, 1, 'Inbox', 0);
INSERT INTO task_lists(id, board_id, name, sort_order)
  SELECT 2, 1, 'In Progress', 1 WHERE EXISTS (SELECT 1 FROM manual_tasks WHERE status = 'in_progress' UNION ALL SELECT 1 FROM automatic_task_occurrences WHERE status = 'in_progress');
INSERT INTO task_lists(id, board_id, name, sort_order)
  SELECT 3, 1, 'Done', 2 WHERE EXISTS (SELECT 1 FROM manual_tasks WHERE status = 'done' UNION ALL SELECT 1 FROM automatic_task_occurrences WHERE status = 'done');
-- SQLite requires NULL when adding a REFERENCES column to a populated table.
-- Triggers below enforce required placement on all subsequent writes.
ALTER TABLE manual_tasks ADD COLUMN list_id INTEGER REFERENCES task_lists(id) ON DELETE RESTRICT;
ALTER TABLE automatic_task_occurrences ADD COLUMN list_id INTEGER REFERENCES task_lists(id) ON DELETE RESTRICT;
UPDATE manual_tasks SET list_id = CASE status WHEN 'in_progress' THEN 2 WHEN 'done' THEN 3 ELSE 1 END;
UPDATE automatic_task_occurrences SET list_id = CASE status WHEN 'in_progress' THEN 2 WHEN 'done' THEN 3 ELSE 1 END;
CREATE TRIGGER manual_task_default_list AFTER INSERT ON manual_tasks WHEN NEW.list_id IS NULL
BEGIN UPDATE manual_tasks SET list_id = 1 WHERE id = NEW.id; END;
CREATE TRIGGER automatic_task_default_list AFTER INSERT ON automatic_task_occurrences WHEN NEW.list_id IS NULL
BEGIN UPDATE automatic_task_occurrences SET list_id = 1 WHERE id = NEW.id; END;
CREATE TRIGGER manual_task_required_list BEFORE UPDATE OF list_id ON manual_tasks WHEN NEW.list_id IS NULL
BEGIN SELECT RAISE(ABORT, 'A task list is required.'); END;
CREATE TRIGGER automatic_task_required_list BEFORE UPDATE OF list_id ON automatic_task_occurrences WHEN NEW.list_id IS NULL
BEGIN SELECT RAISE(ABORT, 'A task list is required.'); END;
CREATE INDEX manual_tasks_list_order_idx ON manual_tasks(list_id, sort_order, id);
CREATE INDEX automatic_tasks_list_order_idx ON automatic_task_occurrences(list_id, sort_order, id);
CREATE INDEX task_lists_board_order_idx ON task_lists(board_id, sort_order, id);
CREATE TRIGGER task_boards_insert_revision AFTER INSERT ON task_boards BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_boards_update_revision AFTER UPDATE ON task_boards BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_boards_delete_revision AFTER DELETE ON task_boards BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_lists_insert_revision AFTER INSERT ON task_lists BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_lists_update_revision AFTER UPDATE ON task_lists BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_lists_delete_revision AFTER DELETE ON task_lists BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
