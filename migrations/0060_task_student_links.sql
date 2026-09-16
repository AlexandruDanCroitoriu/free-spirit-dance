-- Lists are the only task workflow; preserve every existing student relationship.
CREATE TABLE task_students (
  task_id INTEGER NOT NULL REFERENCES manual_tasks(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, student_id)
);
INSERT INTO task_students(task_id, student_id) SELECT id, student_id FROM manual_tasks WHERE student_id IS NOT NULL;
CREATE INDEX task_students_student_idx ON task_students(student_id, task_id);
DROP INDEX manual_tasks_order_idx;
DROP INDEX manual_tasks_due_idx;
DROP INDEX manual_tasks_student_idx;
ALTER TABLE manual_tasks DROP COLUMN status;
ALTER TABLE manual_tasks DROP COLUMN student_id;
CREATE INDEX manual_tasks_due_idx ON manual_tasks(due_date);
CREATE TRIGGER task_students_insert_revision AFTER INSERT ON task_students
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_students_delete_revision AFTER DELETE ON task_students
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_students_update_revision AFTER UPDATE ON task_students
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
UPDATE task_board_state SET revision = revision + 1 WHERE id = 1;
