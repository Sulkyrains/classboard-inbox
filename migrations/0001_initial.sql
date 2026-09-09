PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  salt TEXT NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('作业','活动','事务','课程')),
  location TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '',
  event_at TEXT, deadline_at TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('pending','published','rejected','archived')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','text','ocr','llm')),
  source_text TEXT NOT NULL DEFAULT '', source_hash TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  author_id TEXT, author_name TEXT NOT NULL,
  reviewed_by TEXT, reviewed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS notices_public ON notices(status, pinned DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS notices_deadline ON notices(status, deadline_at);
CREATE INDEX IF NOT EXISTS notices_source ON notices(source_hash);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, notice_id TEXT NOT NULL REFERENCES notices(id),
  actor TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL
);
