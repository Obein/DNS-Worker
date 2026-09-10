-- Migration 0044: Create destination_hourly_rollups table for high-performance destination geo analytics
-- Reduces D1 read row scans on destination queries (getDestinations) by >99% and avoids runtime json_extract()

CREATE TABLE IF NOT EXISTS destination_hourly_rollups (
    profile_id TEXT NOT NULL,
    hour_timestamp INTEGER NOT NULL,
    country_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT '',
    access_point_id TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, hour_timestamp, country_code, country, access_point_id)
);

-- Backfill completed historical hours older than current hour (capped at last 7 days to preserve D1 read quota)
INSERT OR REPLACE INTO destination_hourly_rollups (profile_id, hour_timestamp, country_code, country, access_point_id, count)
SELECT
    profile_id,
    (timestamp / 3600) * 3600 AS hour_timestamp,
    COALESCE(json_extract(dest_geoip, '$.country_code'), '') AS country_code,
    COALESCE(json_extract(dest_geoip, '$.country'), '') AS country,
    COALESCE(access_point_id, '') AS access_point_id,
    COUNT(*) AS count
FROM logs
WHERE timestamp >= (CAST(strftime('%s', 'now') AS INTEGER) - 7 * 86400)
  AND timestamp < (CAST(strftime('%s', 'now') AS INTEGER) / 3600) * 3600
  AND dest_geoip IS NOT NULL
  AND json_extract(dest_geoip, '$.country_code') IS NOT NULL
  AND json_extract(dest_geoip, '$.country_code') != ''
GROUP BY profile_id, (timestamp / 3600) * 3600, COALESCE(json_extract(dest_geoip, '$.country_code'), ''), COALESCE(json_extract(dest_geoip, '$.country'), ''), COALESCE(access_point_id, '');
