-- A saved report can include course payments, practice-party donations, or both.
ALTER TABLE payment_transfer_filters ADD COLUMN payment_types TEXT NOT NULL DEFAULT 'course';
UPDATE payment_transfer_filters
SET payment_types = CASE payment_kind
  WHEN 'practice_party' THEN 'practice_party'
  ELSE 'course'
END;
