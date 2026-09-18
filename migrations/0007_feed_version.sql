-- 通知列表每 30 秒被轮询一次，原来每次都要按索引扫过全部已发布通知。
-- 这里维护一个只有一行的版本号，通知有任何增删改时 +1；请求先读这一行算出 ETag，
-- 没变就直接回 304，省掉整张表的扫描（D1 按扫描行数计费）。
CREATE TABLE IF NOT EXISTS notice_feed (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 1);
INSERT OR IGNORE INTO notice_feed(id,version) VALUES(1,1);
-- /api/admin/notices 按 created_at 倒序取，此前没有对应索引，每次轮询都是全表扫描加排序。
CREATE INDEX IF NOT EXISTS notices_recent ON notices(created_at DESC);
