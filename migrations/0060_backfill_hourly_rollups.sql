-- Migration 0060: Backfill client_hourly_rollups, destination_hourly_rollups, domain_hourly_rollups
-- Resets stale rollup watermark and backfills all 4 rollup tables from available logs

-- 1. log_hourly_rollups
INSERT OR REPLACE INTO log_hourly_rollups (profile_id, hour_timestamp, action, count)
SELECT
    profile_id,
    (timestamp / 3600) * 3600 AS hour_timestamp,
    action,
    COUNT(*) AS count
FROM logs
WHERE timestamp < (CAST(strftime('%s', 'now') AS INTEGER) / 3600) * 3600
GROUP BY profile_id, (timestamp / 3600) * 3600, action;

-- 2. client_hourly_rollups
INSERT OR REPLACE INTO client_hourly_rollups (profile_id, hour_timestamp, client_ip, geo_country, access_point_id, count)
SELECT
    profile_id,
    (timestamp / 3600) * 3600 AS hour_timestamp,
    client_ip,
    COALESCE(geo_country, '') AS geo_country,
    COALESCE(access_point_id, '') AS access_point_id,
    COUNT(*) AS count
FROM logs
WHERE timestamp < (CAST(strftime('%s', 'now') AS INTEGER) / 3600) * 3600
  AND client_ip IS NOT NULL AND client_ip != '' AND client_ip != '[Encrypted]'
GROUP BY profile_id, (timestamp / 3600) * 3600, client_ip, COALESCE(geo_country, ''), COALESCE(access_point_id, '');

-- 3. destination_hourly_rollups
INSERT OR REPLACE INTO destination_hourly_rollups (profile_id, hour_timestamp, country_code, country, access_point_id, count)
SELECT
    profile_id,
    (timestamp / 3600) * 3600 AS hour_timestamp,
    UPPER(CASE 
      WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
      WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
      ELSE ''
    END) AS country_code,
    MAX(CASE 
      WHEN dest_country IS NOT NULL AND dest_country != '' THEN dest_country
      WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country')
      ELSE 'Unknown'
    END) AS country,
    COALESCE(access_point_id, '') AS access_point_id,
    COUNT(*) AS count
FROM logs
WHERE timestamp < (CAST(strftime('%s', 'now') AS INTEGER) / 3600) * 3600
  AND (
    (dest_country_code IS NOT NULL AND dest_country_code != '')
    OR
    (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND json_extract(dest_geoip, '$.country_code') IS NOT NULL AND json_extract(dest_geoip, '$.country_code') != '')
  )
GROUP BY profile_id, (timestamp / 3600) * 3600, 
         UPPER(CASE 
           WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
           WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
           ELSE ''
         END),
         COALESCE(access_point_id, '');

-- 4. domain_hourly_rollups
INSERT OR REPLACE INTO domain_hourly_rollups (profile_id, action, hour_timestamp, domain, count)
SELECT
    profile_id,
    action,
    (timestamp / 3600) * 3600 AS hour_timestamp,
    domain,
    COUNT(*) AS count
FROM logs
WHERE timestamp < (CAST(strftime('%s', 'now') AS INTEGER) / 3600) * 3600
  AND domain IS NOT NULL AND domain != '' AND domain != '[Encrypted]'
GROUP BY profile_id, action, (timestamp / 3600) * 3600, domain
HAVING COUNT(*) >= 1;

-- 5. Update last_hourly_rollup_timestamp in system_settings
INSERT OR REPLACE INTO system_settings (key, value, updated_at)
VALUES (
    'last_hourly_rollup_timestamp',
    CAST((CAST(strftime('%s', 'now') AS INTEGER) / 3600) * 3600 AS TEXT),
    CAST(strftime('%s', 'now') AS INTEGER)
);
