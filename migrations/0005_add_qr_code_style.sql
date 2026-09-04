ALTER TABLE qr_codes ADD COLUMN module_shape TEXT NOT NULL DEFAULT 'square'
  CHECK (module_shape IN ('square', 'circle'));

ALTER TABLE qr_codes ADD COLUMN foreground_color TEXT NOT NULL DEFAULT '#1e293b';
