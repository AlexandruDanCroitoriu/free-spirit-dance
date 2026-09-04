CREATE TABLE qr_codes_clean (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  image_mode TEXT NOT NULL DEFAULT 'none' CHECK (image_mode IN ('none', 'logo', 'custom')),
  image_path TEXT,
  module_shape TEXT NOT NULL DEFAULT 'square' CHECK (module_shape IN ('square', 'circle')),
  foreground_color TEXT NOT NULL DEFAULT '#1e293b',
  eye_shape TEXT NOT NULL DEFAULT 'square' CHECK (eye_shape IN ('square', 'rounded', 'circle')),
  eye_color TEXT NOT NULL DEFAULT '#1e293b',
  logo_size INTEGER NOT NULL DEFAULT 25 CHECK (logo_size BETWEEN 15 AND 30),
  logo_shape TEXT NOT NULL DEFAULT 'square' CHECK (logo_shape IN ('square', 'rounded', 'circle')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO qr_codes_clean (
  id, slug, name, destination_url, active, image_mode, image_path,
  module_shape, foreground_color, eye_shape, eye_color, logo_size,
  logo_shape, created_at, updated_at
)
SELECT
  id, slug, name, destination_url, active, image_mode, image_path,
  module_shape, foreground_color, eye_shape,
  COALESCE(json_extract(advanced_style, '$.eyeColor'), foreground_color),
  logo_size, logo_shape, created_at, updated_at
FROM qr_codes;

DROP TABLE qr_codes;
ALTER TABLE qr_codes_clean RENAME TO qr_codes;
CREATE INDEX qr_codes_updated_at_idx ON qr_codes (updated_at DESC);
