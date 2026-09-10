-- Explicit course assignments are independent of entry balances and attendance.
CREATE TABLE student_courses (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  PRIMARY KEY (student_id, course_id)
);
CREATE INDEX student_courses_course_idx ON student_courses (course_id);
