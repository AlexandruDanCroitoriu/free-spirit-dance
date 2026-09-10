ALTER TABLE attendance ADD COLUMN complimentary_by TEXT;
ALTER TABLE attendance ADD COLUMN complimentary_at TEXT;

-- Split old generated audit lines from administrator notes and retain the latest grant.
CREATE TABLE _free_attendance_lines AS
WITH RECURSIVE lines(id, position, line, rest) AS (
  SELECT id, 0, '', notes || char(10) FROM attendance
  UNION ALL
  SELECT id, position + 1, substr(rest, 1, instr(rest, char(10)) - 1),
    substr(rest, instr(rest, char(10)) + 1) FROM lines WHERE rest != ''
)
SELECT id, position, line,
  CASE WHEN line GLOB 'Complimentary granted by * at ????-??-??T*'
    OR line GLOB 'Complimentary removed by * at ????-??-??T*' THEN 1 ELSE 0 END AS generated
FROM lines WHERE position > 0;
UPDATE attendance SET
  complimentary_by = CASE WHEN complimentary = 1 THEN COALESCE((
    SELECT substr(line, 26, instr(line, ' at ') - 26) FROM _free_attendance_lines
    WHERE id = attendance.id AND generated = 1 AND line LIKE 'Complimentary granted by %'
    ORDER BY position DESC LIMIT 1), recorded_by) END,
  complimentary_at = CASE WHEN complimentary = 1 THEN COALESCE((
    SELECT substr(line, instr(line, ' at ') + 4, 24) FROM _free_attendance_lines
    WHERE id = attendance.id AND generated = 1 AND line LIKE 'Complimentary granted by %'
    ORDER BY position DESC LIMIT 1), recorded_at) END,
  notes = COALESCE((SELECT group_concat(line, char(10)) FROM (
    SELECT line FROM _free_attendance_lines WHERE id = attendance.id AND generated = 0 ORDER BY position
  )), '');
DROP TABLE _free_attendance_lines;
