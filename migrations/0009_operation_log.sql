-- 操作日志：记录班委对通知做过什么（谁、什么职位、在哪条通知上、做了什么），只给班长查看。
-- 不设外键、另存标题快照：通知被永久删除后日志仍要留痕（audit_log 有外键，只能跟着通知一起删）。
CREATE TABLE IF NOT EXISTS operation_log (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL,
  notice_title TEXT NOT NULL DEFAULT '',
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_position TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_log_created ON operation_log(created_at DESC);
-- 老 audit_log 的历史并进新表（当时没记职位与详情，留空）。
-- 老表保留、不再写入：回滚到旧版本 Worker 时它还在，不会 500。
INSERT OR IGNORE INTO operation_log(id,notice_id,notice_title,actor_id,actor_name,actor_position,action,detail,created_at)
  SELECT a.id,a.notice_id,COALESCE(n.title,''),NULL,a.actor,'',a.action,'',a.created_at FROM audit_log a LEFT JOIN notices n ON n.id=a.notice_id;
