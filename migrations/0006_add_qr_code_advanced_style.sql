ALTER TABLE qr_codes ADD COLUMN eye_shape TEXT NOT NULL DEFAULT 'square'
  CHECK (eye_shape IN ('square', 'rounded', 'circle'));

ALTER TABLE qr_codes ADD COLUMN background_color TEXT NOT NULL DEFAULT '#ffffff';

ALTER TABLE qr_codes ADD COLUMN logo_size INTEGER NOT NULL DEFAULT 25
  CHECK (logo_size BETWEEN 15 AND 30);
