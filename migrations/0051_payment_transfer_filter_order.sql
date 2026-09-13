ALTER TABLE payment_transfer_filters ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE payment_transfer_filters SET sort_order = id WHERE sort_order = 0;
CREATE INDEX payment_transfer_filters_order_idx ON payment_transfer_filters (administrator_email, sort_order, id);
