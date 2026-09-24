-- 账号管理页（仅班长）要显示「最后一次登录」：users 里没有这个字段，补一列。
-- 迁移前就存在的账号为 NULL，表示「还没有记录」；登录成功时写入时间。
ALTER TABLE users ADD COLUMN last_login_at TEXT;
-- 重置密码、强制下线这类动作不属于某条通知，不能混进 operation_log（那张表按通知组织）。
-- 这里单独留痕：谁、什么职位、动了哪个账号、做了什么。不设外键，
-- 账号以后被清理掉，记录仍然可读（account_label 是当时的「姓名（学号）」快照）。
CREATE TABLE IF NOT EXISTS account_log (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  account_label TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_position TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_log_created ON account_log(created_at DESC);
