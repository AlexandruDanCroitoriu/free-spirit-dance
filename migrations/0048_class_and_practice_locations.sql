-- Keep the venue and rental cost with the individual session it belongs to.
ALTER TABLE classes ADD COLUMN location TEXT NOT NULL DEFAULT '';

ALTER TABLE practice_parties ADD COLUMN location TEXT NOT NULL DEFAULT '';
ALTER TABLE practice_parties ADD COLUMN rent_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (rent_cost_minor >= 0);
ALTER TABLE practice_parties ADD COLUMN rent_paid INTEGER NOT NULL DEFAULT 0 CHECK (rent_paid IN (0, 1));
