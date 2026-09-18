-- Keep existing task statuses and links intact while widening the status check.
-- SQLite cannot alter a CHECK constraint in place, so replace only this column.
ALTER TABLE manual_tasks ADD COLUMN status_replacement TEXT NOT NULL DEFAULT 'in_progress'
  CHECK(status_replacement IN ('in_progress', 'blocked', 'done'));
UPDATE manual_tasks SET status_replacement = status;
ALTER TABLE manual_tasks DROP COLUMN status;
ALTER TABLE manual_tasks RENAME COLUMN status_replacement TO status;
