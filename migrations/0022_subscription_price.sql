-- Existing prices are unknown, not free. Require a price on new API saves.
-- RON amounts are stored as integer bani (100 bani = 1 RON).
ALTER TABLE subscription ADD COLUMN price_minor INTEGER
  CHECK (price_minor IS NULL OR (typeof(price_minor) = 'integer' AND price_minor BETWEEN 0 AND 99999999));
