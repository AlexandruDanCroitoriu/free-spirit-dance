-- Preserve existing saved selections; draft rows intentionally match nobody.
ALTER TABLE payment_transfer_filters ADD COLUMN collector_emails TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(collector_emails) AND json_type(collector_emails) = 'array');
UPDATE payment_transfer_filters SET collector_emails = json_array(collector_email)
WHERE payment_kind != 'multiple_courses';
