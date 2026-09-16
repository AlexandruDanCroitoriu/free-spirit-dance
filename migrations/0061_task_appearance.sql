-- Shared list/board colors and an administrator's private Inbox appearance.
CREATE TABLE task_preferences (
  email TEXT PRIMARY KEY COLLATE NOCASE REFERENCES admin_profiles(email) ON DELETE CASCADE,
  inbox_color TEXT NOT NULL DEFAULT 'default' CHECK(inbox_color IN ('default','navy','ocean','blue','plum','lilac','sunset','rose','lagoon','slate','ember','azure','gold','green','brick','purple','pink','mint','cyan','gray'))
);
ALTER TABLE task_boards ADD COLUMN color TEXT NOT NULL DEFAULT 'default' CHECK(color IN ('default','navy','ocean','blue','plum','lilac','sunset','rose','lagoon','slate','ember','azure','gold','green','brick','purple','pink','mint','cyan','gray'));
ALTER TABLE task_lists ADD COLUMN color TEXT NOT NULL DEFAULT 'default' CHECK(color IN ('default','navy','ocean','blue','plum','lilac','sunset','rose','lagoon','slate','ember','azure','gold','green','brick','purple','pink','mint','cyan','gray'));
CREATE TRIGGER task_preferences_insert_revision AFTER INSERT ON task_preferences
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_preferences_update_revision AFTER UPDATE ON task_preferences
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER task_preferences_delete_revision AFTER DELETE ON task_preferences
BEGIN UPDATE task_board_state SET revision = revision + 1 WHERE id = 1; END;
UPDATE task_board_state SET revision = revision + 1 WHERE id = 1;
