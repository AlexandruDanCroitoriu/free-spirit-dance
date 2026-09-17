CREATE TABLE class_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  administrator_email TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  student_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX class_change_log_class_idx ON class_change_log (class_id, created_at DESC, id DESC);

-- Creation can be inferred for older attendance-backed classes. Later edits
-- cannot be reconstructed reliably, so no change entries are invented for them.
INSERT INTO class_change_log (class_id, administrator_email, action, created_at)
SELECT cl.id, cl.created_by, 'created', COALESCE(
  (SELECT MIN(COALESCE(a.recorded_at, a.attended_at)) FROM attendance a WHERE a.class_id = cl.id),
  '1970-01-01T00:00:00Z'
) FROM classes cl WHERE cl.created_by IS NOT NULL;
