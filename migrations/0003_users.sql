CREATE TABLE users (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('committee','student')),
 salt TEXT NOT NULL, digest TEXT NOT NULL,
 must_change_password INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
);
CREATE TABLE user_sessions (
 id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX user_sessions_expiry ON user_sessions(expires_at);
CREATE TABLE notice_reads (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 notice_id TEXT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,notice_id)
);
DELETE FROM sessions;
