ALTER TABLE administrator_permissions ADD COLUMN can_free_events INTEGER NOT NULL DEFAULT 0
  CHECK (can_free_events IN (0, 1));

-- Free Events previously shared the Practice Parties permission. Preserve that
-- access when upgrading existing administrator records.
UPDATE administrator_permissions SET can_free_events = can_practice_parties;
