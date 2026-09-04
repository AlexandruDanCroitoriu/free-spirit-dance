CREATE TABLE IF NOT EXISTS administrator_permissions (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  can_dashboard INTEGER NOT NULL DEFAULT 0 CHECK (can_dashboard IN (0, 1)),
  can_students INTEGER NOT NULL DEFAULT 0 CHECK (can_students IN (0, 1)),
  can_courses INTEGER NOT NULL DEFAULT 0 CHECK (can_courses IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
