-- A course supplies the default rent for future occurrences. Each recorded
-- class keeps its own snapshot so historical rent amounts remain accurate.
ALTER TABLE courses ADD COLUMN class_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (class_cost_minor >= 0);
ALTER TABLE classes ADD COLUMN rent_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (rent_cost_minor >= 0);
ALTER TABLE classes ADD COLUMN rent_paid INTEGER NOT NULL DEFAULT 0 CHECK (rent_paid IN (0, 1));

-- Existing class records predate rent tracking; retain them as zero-cost and
-- unconfirmed rather than inventing historical financial data.
