-- Rich task descriptions store mention metadata as well as their visible text.
-- Rebuild the task table to widen its description CHECK without losing tasks,
-- linked records, images, placement, or revision tracking.
PRAGMA defer_foreign_keys = ON;

DROP TRIGGER manual_tasks_insert_revision;
DROP TRIGGER manual_tasks_update_revision;
DROP TRIGGER manual_tasks_delete_revision;
DROP TRIGGER manual_task_placement_insert;
DROP TRIGGER manual_task_shared_default;
DROP TRIGGER manual_task_placement_update;
DROP TRIGGER task_students_insert_revision;
DROP TRIGGER task_students_delete_revision;
DROP TRIGGER task_students_update_revision;
DROP TRIGGER task_courses_insert_revision;
DROP TRIGGER task_courses_delete_revision;
DROP TRIGGER task_courses_update_revision;
DROP TRIGGER task_images_delete_object;

ALTER TABLE task_students RENAME TO task_students_previous;
ALTER TABLE task_courses RENAME TO task_courses_previous;
ALTER TABLE task_free_events RENAME TO task_free_events_previous;
ALTER TABLE task_free_meetings RENAME TO task_free_meetings_previous;
ALTER TABLE task_images RENAME TO task_images_previous;
ALTER TABLE manual_tasks RENAME TO manual_tasks_previous;

CREATE TABLE manual_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 50000),
  due_date TEXT CHECK (due_date IS NULL OR (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(due_date, '+0 days') IS NOT NULL AND date(due_date, '+0 days') = due_date)),
  sort_order INTEGER NOT NULL CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0),
  created_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  updated_at TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_payload TEXT NOT NULL,
  list_id INTEGER REFERENCES task_lists(id) ON DELETE RESTRICT,
  inbox_owner TEXT COLLATE NOCASE REFERENCES admin_profiles(email) CHECK (inbox_owner IS NULL OR (length(trim(inbox_owner)) > 0 AND inbox_owner = lower(trim(inbox_owner)))),
  administrator_emails TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(administrator_emails) AND json_type(administrator_emails) = 'array'),
  assigned_to TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'blocked', 'done'))
);

INSERT INTO manual_tasks (id, title, description, due_date, sort_order, created_by, created_at, updated_by, updated_at, request_key, request_payload, list_id, inbox_owner, administrator_emails, assigned_to, status)
SELECT id, title, description, due_date, sort_order, created_by, created_at, updated_by, updated_at, request_key, request_payload, list_id, inbox_owner, administrator_emails, assigned_to, status
FROM manual_tasks_previous;

CREATE TABLE task_students (
  task_id INTEGER NOT NULL REFERENCES manual_tasks(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, student_id)
);
INSERT INTO task_students SELECT * FROM task_students_previous;

CREATE TABLE task_courses (
  task_id INTEGER NOT NULL REFERENCES manual_tasks(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, course_id)
);
INSERT INTO task_courses SELECT * FROM task_courses_previous;

CREATE TABLE task_free_events (
  task_id INTEGER NOT NULL REFERENCES manual_tasks(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES free_events(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, event_id)
);
INSERT INTO task_free_events SELECT * FROM task_free_events_previous;

CREATE TABLE task_free_meetings (
  task_id INTEGER NOT NULL REFERENCES manual_tasks(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL REFERENCES free_event_meetings(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, meeting_id)
);
INSERT INTO task_free_meetings SELECT * FROM task_free_meetings_previous;

CREATE TABLE task_images (
  id TEXT PRIMARY KEY CHECK(length(id) = 36),
  task_id INTEGER REFERENCES manual_tasks(id) ON DELETE CASCADE,
  owner_email TEXT NOT NULL COLLATE NOCASE,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
INSERT INTO task_images SELECT * FROM task_images_previous;

DROP TABLE task_students_previous;
DROP TABLE task_courses_previous;
DROP TABLE task_free_events_previous;
DROP TABLE task_free_meetings_previous;
DROP TABLE task_images_previous;
DROP TABLE manual_tasks_previous;

INSERT OR REPLACE INTO sqlite_sequence(name, seq) VALUES ('manual_tasks', (SELECT COALESCE(MAX(id), 0) FROM manual_tasks));
CREATE INDEX manual_tasks_due_idx ON manual_tasks(due_date);
CREATE INDEX manual_tasks_list_order_idx ON manual_tasks(list_id, sort_order, id);
CREATE INDEX manual_tasks_inbox_order_idx ON manual_tasks(inbox_owner, sort_order, id);
CREATE INDEX task_students_student_idx ON task_students(student_id, task_id);
CREATE INDEX task_courses_course_idx ON task_courses(course_id, task_id);
CREATE INDEX task_images_task_idx ON task_images(task_id);
CREATE INDEX task_images_expiry_idx ON task_images(expires_at) WHERE task_id IS NULL;

CREATE TRIGGER manual_tasks_insert_revision AFTER INSERT ON manual_tasks
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER manual_tasks_update_revision AFTER UPDATE ON manual_tasks
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER manual_tasks_delete_revision AFTER DELETE ON manual_tasks
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER manual_task_placement_insert BEFORE INSERT ON manual_tasks
WHEN NEW.list_id IS NOT NULL AND NEW.inbox_owner IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Choose a shared list or a personal Inbox.'); END;
CREATE TRIGGER manual_task_shared_default AFTER INSERT ON manual_tasks
WHEN NEW.list_id IS NULL AND NEW.inbox_owner IS NULL
BEGIN UPDATE manual_tasks SET list_id = 1 WHERE id = NEW.id; END;
CREATE TRIGGER manual_task_placement_update BEFORE UPDATE OF list_id, inbox_owner ON manual_tasks
WHEN (NEW.list_id IS NULL) = (NEW.inbox_owner IS NULL)
BEGIN SELECT RAISE(ABORT, 'Choose a shared list or a personal Inbox.'); END;
CREATE TRIGGER task_students_insert_revision AFTER INSERT ON task_students
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_students_delete_revision AFTER DELETE ON task_students
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_students_update_revision AFTER UPDATE ON task_students
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_courses_insert_revision AFTER INSERT ON task_courses
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_courses_delete_revision AFTER DELETE ON task_courses
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_courses_update_revision AFTER UPDATE ON task_courses
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_images_delete_object AFTER DELETE ON task_images
BEGIN
  INSERT OR IGNORE INTO task_image_deletions(object_key, created_at) VALUES (OLD.object_key, CURRENT_TIMESTAMP);
END;
