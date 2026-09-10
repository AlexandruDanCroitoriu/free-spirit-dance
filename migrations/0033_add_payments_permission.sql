ALTER TABLE administrator_permissions ADD COLUMN can_payments INTEGER NOT NULL DEFAULT 0
  CHECK (can_payments IN (0, 1));

-- Preserve access previously granted through the Students permission.
UPDATE administrator_permissions SET can_payments = can_students;
