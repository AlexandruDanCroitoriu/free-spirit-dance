ALTER TABLE administrator_permissions ADD COLUMN can_qr_codes INTEGER NOT NULL DEFAULT 0
  CHECK (can_qr_codes IN (0, 1));

-- Existing administrators already had QR access; preserve it on upgrade.
UPDATE administrator_permissions SET can_qr_codes = 1;
