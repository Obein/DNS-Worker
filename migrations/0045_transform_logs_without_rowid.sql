-- Migration 0045: Transform logs table to WITHOUT ROWID clustered table
-- Reduces D1 write amplification from 2 to 1 row per DNS insert (50% write cost reduction)
-- Eliminates table-seek reads on time-range queries by clustering data along (profile_id, timestamp, id)

-- 1. Create the clustered WITHOUT ROWID logs table
CREATE TABLE IF NOT EXISTS logs_v2 (
    profile_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    id INTEGER NOT NULL,
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
    access_point_id TEXT,
    PRIMARY KEY (profile_id, timestamp, id)
) WITHOUT ROWID;

-- 2. Migrate existing logs
INSERT INTO logs_v2 (
    id, profile_id, timestamp, client_ip, geo_country, domain, record_type, action, reason, answer, dest_geoip, ecs, upstream, latency, access_point_id
)
SELECT
    id, profile_id, timestamp, client_ip, geo_country, domain, record_type, action, reason, answer, dest_geoip, ecs, upstream, latency, access_point_id
FROM logs;

-- 3. Replace logs table
DROP TABLE logs;
ALTER TABLE logs_v2 RENAME TO logs;

-- 4. Ensure no redundant secondary indexes exist
DROP INDEX IF EXISTS idx_logs_profile_time;
