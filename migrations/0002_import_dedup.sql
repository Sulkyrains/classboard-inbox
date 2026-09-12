CREATE UNIQUE INDEX IF NOT EXISTS notices_active_source ON notices(source_hash)
WHERE source_hash IS NOT NULL AND status IN ('pending','published');
