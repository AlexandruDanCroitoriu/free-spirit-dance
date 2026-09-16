-- Task images are private R2 objects. D1 is the source of truth for their
-- ownership; the outbox makes R2 deletion retryable when a Worker is down.
CREATE TABLE task_images (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  task_id INTEGER REFERENCES manual_tasks(id) ON DELETE CASCADE,
  owner_email TEXT NOT NULL COLLATE NOCASE,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX task_images_task_idx ON task_images(task_id);
CREATE INDEX task_images_expiry_idx ON task_images(expires_at) WHERE task_id IS NULL;

CREATE TABLE task_image_deletions (
  object_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TRIGGER task_images_delete_object AFTER DELETE ON task_images
BEGIN
  INSERT OR IGNORE INTO task_image_deletions(object_key, created_at) VALUES (OLD.object_key, CURRENT_TIMESTAMP);
END;
