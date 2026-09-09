-- Restore the five application tables represented in docs/database.drawio.
-- Experimental subscription and attendance records are intentionally removed.
-- IF EXISTS also supports fresh databases built from migrations 0001-0014.
DROP TRIGGER IF EXISTS protect_course_schedule;
DROP TRIGGER IF EXISTS courses_subscription_delete;
DROP TRIGGER IF EXISTS courses_subscription_insert;
DROP TRIGGER IF EXISTS courses_subscription_update;

DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS subscription_coverage;
DROP TABLE IF EXISTS subscription_pauses;
DROP TABLE IF EXISTS subscription_courses;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS course_occurrences;
DROP TABLE IF EXISTS couple_purchases;
DROP TABLE IF EXISTS subscription_types;
DROP TABLE IF EXISTS subscription_revision;

-- Copy the retained columns so this works with or without can_subscriptions.
CREATE TABLE administrator_permissions_clean (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  can_dashboard INTEGER NOT NULL DEFAULT 0 CHECK (can_dashboard IN (0, 1)),
  can_students INTEGER NOT NULL DEFAULT 0 CHECK (can_students IN (0, 1)),
  can_courses INTEGER NOT NULL DEFAULT 0 CHECK (can_courses IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO administrator_permissions_clean
  (email, can_dashboard, can_students, can_courses, created_at, updated_at)
SELECT email, can_dashboard, can_students, can_courses, created_at, updated_at
FROM administrator_permissions;

DROP TABLE administrator_permissions;
ALTER TABLE administrator_permissions_clean RENAME TO administrator_permissions;
