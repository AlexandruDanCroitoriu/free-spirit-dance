CREATE UNIQUE INDEX students_phone_unique_idx
ON students (trim(phone))
WHERE trim(phone) <> '';
