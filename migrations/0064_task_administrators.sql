ALTER TABLE manual_tasks ADD COLUMN administrator_emails TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(administrator_emails) AND json_type(administrator_emails) = 'array');
ALTER TABLE manual_tasks ADD COLUMN assigned_to TEXT;
