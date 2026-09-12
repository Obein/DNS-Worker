-- Migration 0049: Optimize Rollup Indexes and Create domain_hourly_rollups Table
-- 1. Create domain_hourly_rollups table for high-throughput stream pre-aggregation
CREATE TABLE IF NOT EXISTS domain_hourly_rollups (
    profile_id TEXT NOT NULL,
    hour_timestamp INTEGER NOT NULL,
    domain TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('PASS', 'BLOCK', 'REDIRECT', 'FAIL')),
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, hour_timestamp, domain, action)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_domain_rollups_query 
ON domain_hourly_rollups (profile_id, action, hour_timestamp, domain, count);

CREATE INDEX IF NOT EXISTS idx_domain_rollups_hour 
ON domain_hourly_rollups (hour_timestamp);

-- 2. Add single-column indexes on hour_timestamp to eliminate 320k+ row full table scans on SELECT MAX(hour_timestamp)
CREATE INDEX IF NOT EXISTS idx_destination_rollups_hour 
ON destination_hourly_rollups (hour_timestamp);

CREATE INDEX IF NOT EXISTS idx_log_rollups_hour 
ON log_hourly_rollups (hour_timestamp);

CREATE INDEX IF NOT EXISTS idx_client_rollups_hour 
ON client_hourly_rollups (hour_timestamp);

-- 3. Initial backfill for recent completed hours (last 7 days) to seed top blocked domains
INSERT OR REPLACE INTO domain_hourly_rollups (profile_id, hour_timestamp, domain, action, count)
SELECT
    profile_id,
    (timestamp / 3600) * 3600 AS hour_timestamp,
    domain,
    action,
    COUNT(*) AS count
FROM logs
WHERE timestamp >= (CAST(strftime('%s', 'now') AS INTEGER) - 7 * 86400)
  AND timestamp < (CAST(strftime('%s', 'now') AS INTEGER) / 3600) * 3600
  AND action IN ('BLOCK', 'REDIRECT', 'FAIL')
GROUP BY profile_id, (timestamp / 3600) * 3600, domain, action;
