-- Rent is set per weekly class slot. Keep the old course-level value only as
-- legacy data, and copy it into existing schedule rows during the transition.
ALTER TABLE course_schedule ADD COLUMN rent_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (rent_cost_minor >= 0);
UPDATE course_schedule SET rent_cost_minor = (SELECT class_cost_minor FROM courses WHERE courses.id = course_schedule.course_id);
