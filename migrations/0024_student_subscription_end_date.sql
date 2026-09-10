-- Existing purchases retain their original dates and grants. Their historical
-- course schedules are unavailable, so do not invent an expiry for them.
ALTER TABLE student_subscriptions ADD COLUMN ends_on TEXT
  CHECK (ends_on IS NULL OR (length(ends_on) = 10 AND ends_on >= starts_on));
