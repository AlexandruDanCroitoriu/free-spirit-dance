ALTER TABLE qr_codes ADD COLUMN logo_shape TEXT NOT NULL DEFAULT 'square'
  CHECK (logo_shape IN ('square', 'rounded', 'circle'));
