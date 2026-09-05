-- 1. Create the new optimized logs table
-- Improvements:
--   - Removed AUTOINCREMENT: uses SQLite native 64-bit rowid, eliminating 1 read and 1 write to sqlite_sequence per insert
--   - Removed FOREIGN KEY constraints: eliminates 2 index-seek reads to profiles and access_points per insert
CREATE TABLE IF NOT EXISTS logs_new (
    id INTEGER PRIMARY KEY,
    profile_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    client_ip TEXT,
    geo_country TEXT,
    domain TEXT NOT NULL,
    record_type TEXT NOT NULL,
    action TEXT CHECK(action IN ('PASS', 'BLOCK', 'REDIRECT', 'FAIL')) NOT NULL,
    reason TEXT,
    answer TEXT,
    dest_geoip TEXT,
    ecs TEXT,
    upstream TEXT,
    latency INTEGER,
    access_point_id TEXT
);

-- 2. Migrate unexpired logs within 90-day retention window
-- (Automatically purges expired records, reducing database disk size)
INSERT INTO logs_new (id, profile_id, timestamp, client_ip, geo_country, domain, record_type, action, reason, answer, dest_geoip, ecs, upstream, latency, access_point_id)
SELECT id, profile_id, timestamp, client_ip, geo_country, domain, record_type, action, reason, answer, dest_geoip, ecs, upstream, latency, access_point_id
FROM logs
WHERE timestamp >= (strftime('%s', 'now') - 7776000);

-- 3. Replace logs table
DROP TABLE logs;
ALTER TABLE logs_new RENAME TO logs;

-- 4. Clean up sqlite_sequence entry if present
DELETE FROM sqlite_sequence WHERE name = 'logs';

-- 5. Create strictly curated composite indexes (3 core indexes)
-- Baseline time index for default profile queries and range cleanup
CREATE INDEX IF NOT EXISTS idx_logs_profile_time ON logs(profile_id, timestamp);

-- Device-level time index for access point filtering
CREATE INDEX IF NOT EXISTS idx_logs_profile_ap_time ON logs(profile_id, access_point_id, timestamp);

-- Action-level time index for ALLOW / BLOCK filtering and top stats
CREATE INDEX IF NOT EXISTS idx_logs_profile_action_time ON logs(profile_id, action, timestamp);

-- 6. System indexes to prevent full-table scans in background jobs
CREATE INDEX IF NOT EXISTS idx_profiles_list_updated ON profiles(list_updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
