-- Migration 0041: Create log_hourly_rollups table for high-performance analytics aggregation
-- Reduces D1 read row scans on analytics queries (getSummary, getTrend) by >98%

CREATE TABLE IF NOT EXISTS log_hourly_rollups (
    profile_id TEXT NOT NULL,
    hour_timestamp INTEGER NOT NULL,
    action TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, hour_timestamp, action)
);

-- Backfill completed historical hours older than current hour
INSERT OR REPLACE INTO log_hourly_rollups (profile_id, hour_timestamp, action, count)
SELECT
    profile_id,
    (timestamp / 3600) * 3600 AS hour_timestamp,
    action,
    COUNT(*) AS count
FROM logs
WHERE timestamp < (CAST(strftime('%s', 'now') AS INTEGER) / 3600) * 3600
GROUP BY profile_id, (timestamp / 3600) * 3600, action;
