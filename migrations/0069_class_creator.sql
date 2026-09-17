ALTER TABLE classes ADD COLUMN created_by TEXT COLLATE NOCASE REFERENCES admin_profiles(email);

-- Older class rows were made when attendance was recorded. Use the first
-- recorded attendance for each class; classes without attendance stay unknown.
UPDATE classes SET created_by = (
  SELECT a.recorded_by FROM attendance a
  WHERE a.class_id = classes.id
  ORDER BY COALESCE(a.recorded_at, a.attended_at), a.id
  LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM attendance a WHERE a.class_id = classes.id);
