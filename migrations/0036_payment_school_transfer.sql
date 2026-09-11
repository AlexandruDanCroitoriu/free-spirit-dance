-- Unchecked means no handover has been confirmed, including historical payments.
ALTER TABLE student_payments ADD COLUMN given_to_school INTEGER NOT NULL DEFAULT 0 CHECK (given_to_school IN (0, 1));
CREATE INDEX student_payments_date_idx ON student_payments (paid_on DESC, id DESC);
