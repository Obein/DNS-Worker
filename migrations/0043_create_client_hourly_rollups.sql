-- Migration 0043: Create client_hourly_rollups table for high-performance client analytics
-- Reduces D1 read row scans on client queries (getClients) by >98%

CREATE TABLE IF NOT EXISTS client_hourly_rollups (
    profile_id TEXT NOT NULL,
    hour_timestamp INTEGER NOT NULL,
    client_ip TEXT NOT NULL,
    geo_country TEXT NOT NULL DEFAULT '',
    access_point_id TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, hour_timestamp, client_ip, geo_country, access_point_id)
);

-- Backfill completed historical hours older than current hour (capped at last 7 days to preserve D1 read quota)
INSERT OR REPLACE INTO client_hourly_rollups (profile_id, hour_timestamp, client_ip, geo_country, access_point_id, count)
SELECT
    profile_id,
    (timestamp / 3600) * 3600 AS hour_timestamp,
    client_ip,
    COALESCE(geo_country, '') AS geo_country,
    COALESCE(access_point_id, '') AS access_point_id,
    COUNT(*) AS count
FROM logs
WHERE timestamp >= (CAST(strftime('%s', 'now') AS INTEGER) - 7 * 86400)
  AND timestamp < (CAST(strftime('%s', 'now') AS INTEGER) / 3600) * 3600
GROUP BY profile_id, (timestamp / 3600) * 3600, client_ip, COALESCE(geo_country, ''), COALESCE(access_point_id, '');
