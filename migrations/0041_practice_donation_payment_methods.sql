ALTER TABLE practice_attendance ADD COLUMN donation_received_method TEXT NOT NULL DEFAULT '';

DROP VIEW school_payment_records;
CREATE VIEW school_payment_records AS
SELECT p.id, 'course' AS purpose, NULL AS practice_id, NULL AS practice_description,
  p.student_id, p.paid_on, p.amount_minor, p.recorded_by, p.received_method, p.given_to_school
FROM student_payments p
UNION ALL
SELECT a.id, 'practice_donation', a.practice_id, 'Practice party · ' || s.starts_at,
  a.student_id, a.donation_paid_on, a.donation_amount_minor, a.donation_recorded_by, a.donation_received_method, a.donation_given_to_school
FROM practice_attendance a JOIN practice_parties s ON s.id = a.practice_id
WHERE a.donation_amount_minor IS NOT NULL;
