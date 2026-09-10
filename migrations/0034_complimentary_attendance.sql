ALTER TABLE attendance ADD COLUMN complimentary INTEGER NOT NULL DEFAULT 0 CHECK (complimentary IN (0, 1));
