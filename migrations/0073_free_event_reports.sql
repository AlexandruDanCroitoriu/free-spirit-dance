ALTER TABLE free_event_attendance ADD COLUMN donation_given_to_school INTEGER NOT NULL DEFAULT 0 CHECK (donation_given_to_school IN (0, 1));

CREATE VIEW report_payment_records AS
SELECT p.*, NULL AS event_id, NULL AS meeting_id, NULL AS event_name
FROM school_payment_records p
UNION ALL
SELECT a.id, 'free_event_donation', NULL, e.name || ' · ' || m.name,
  a.student_id, substr(m.starts_at, 1, 10), a.donation_amount_minor,
  a.recorded_by, a.donation_received_method, a.donation_given_to_school,
  e.id, m.id, e.name
FROM free_event_attendance a
JOIN free_event_meetings m ON m.id = a.meeting_id
JOIN free_events e ON e.id = m.event_id
WHERE a.donation_amount_minor IS NOT NULL;
