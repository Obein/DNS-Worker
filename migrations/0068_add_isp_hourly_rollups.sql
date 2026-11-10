-- Migration 0068: Add Destination ISP rollups to unified hourly_rollups
-- Enables persistent, low-overhead ISP distribution statistics across countries
-- surviving raw log retention pruning and zero-knowledge encryption.

INSERT OR IGNORE INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
SELECT 
    profile_id,
    'isp' AS metric_type,
    (timestamp / 3600) * 3600 AS hour_timestamp,
    UPPER(CASE 
        WHEN dest_country_code IS NOT NULL AND dest_country_code != '' THEN dest_country_code
        WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN json_extract(dest_geoip, '$.country_code')
        ELSE ''
    END) AS key,
    CASE 
        WHEN dest_isp IS NOT NULL AND dest_isp != '' THEN dest_isp
        WHEN dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' THEN COALESCE(NULLIF(json_extract(dest_geoip, '$.isp'), ''), json_extract(dest_geoip, '$.org'))
        ELSE ''
    END AS sub_key,
    COALESCE(access_point_id, '') AS access_point_id,
    COUNT(*) AS count
FROM logs
WHERE profile_id IS NOT NULL
  AND (
    (dest_isp IS NOT NULL AND dest_isp != '')
    OR
    (dest_geoip IS NOT NULL AND dest_geoip != '' AND dest_geoip LIKE '{%' AND (
      (json_extract(dest_geoip, '$.isp') IS NOT NULL AND json_extract(dest_geoip, '$.isp') != '')
      OR
      (json_extract(dest_geoip, '$.org') IS NOT NULL AND json_extract(dest_geoip, '$.org') != '')
    ))
  )
GROUP BY profile_id, (timestamp / 3600) * 3600, key, sub_key, COALESCE(access_point_id, '')
HAVING sub_key != '';
