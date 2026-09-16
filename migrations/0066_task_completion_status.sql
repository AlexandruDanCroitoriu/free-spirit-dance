ALTER TABLE manual_tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'done'));
