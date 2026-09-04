ALTER TABLE qr_codes ADD COLUMN image_mode TEXT NOT NULL DEFAULT 'none'
  CHECK (image_mode IN ('none', 'logo', 'custom'));

ALTER TABLE qr_codes ADD COLUMN image_path TEXT;
