-- Existing courses retain unbounded schedules until administrators set dates.
ALTER TABLE courses ADD COLUMN start_date TEXT;
ALTER TABLE courses ADD COLUMN end_date TEXT CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
