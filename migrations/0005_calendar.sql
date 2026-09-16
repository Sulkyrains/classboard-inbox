ALTER TABLE users ADD COLUMN calendar_token TEXT;
CREATE UNIQUE INDEX users_calendar_token ON users(calendar_token);
