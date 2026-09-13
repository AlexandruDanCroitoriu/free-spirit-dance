-- Each administrator owns their own saved payment-transfer report rows.
CREATE TABLE payment_transfer_filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  administrator_email TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  collector_email TEXT NOT NULL COLLATE NOCASE REFERENCES admin_profiles(email),
  from_date TEXT,
  to_date TEXT,
  payment_kind TEXT NOT NULL CHECK (payment_kind IN ('course', 'multiple_courses', 'practice_party')),
  created_at TEXT NOT NULL,
  CHECK (from_date IS NULL OR from_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (to_date IS NULL OR to_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (from_date IS NULL OR to_date IS NULL OR from_date <= to_date)
);
CREATE INDEX payment_transfer_filters_administrator_idx ON payment_transfer_filters (administrator_email, id);
