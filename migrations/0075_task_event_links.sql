CREATE TABLE task_free_events (
  task_id INTEGER NOT NULL REFERENCES manual_tasks(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES free_events(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, event_id)
);

CREATE TABLE task_free_meetings (
  task_id INTEGER NOT NULL REFERENCES manual_tasks(id) ON DELETE CASCADE,
  meeting_id INTEGER NOT NULL REFERENCES free_event_meetings(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, meeting_id)
);
