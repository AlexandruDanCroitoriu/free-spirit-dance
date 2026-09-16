CREATE TABLE task_courses (
  task_id INTEGER NOT NULL REFERENCES manual_tasks(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, course_id)
);
CREATE INDEX task_courses_course_idx ON task_courses(course_id, task_id);
CREATE TRIGGER task_courses_insert_revision AFTER INSERT ON task_courses
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_courses_delete_revision AFTER DELETE ON task_courses
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_courses_update_revision AFTER UPDATE ON task_courses
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
