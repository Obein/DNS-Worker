-- Migration 0061: Consolidate hourly rollups into unified multi-dimensional fact table
-- Replaces log_hourly_rollups, domain_hourly_rollups, client_hourly_rollups, and destination_hourly_rollups
-- with a single clustered WITHOUT ROWID table.
-- Minimizes write amplification and ensures tightly bounded index seek scans for queries.

-- 1. Create unified hourly_rollups clustered table
CREATE TABLE IF NOT EXISTS hourly_rollups (
    profile_id TEXT NOT NULL,
    metric_type TEXT NOT NULL,
    hour_timestamp INTEGER NOT NULL,
    key TEXT NOT NULL,
    sub_key TEXT NOT NULL DEFAULT '',
    access_point_id TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (
        profile_id,
        metric_type,
        hour_timestamp,
        key,
        sub_key,
        access_point_id
    )
) WITHOUT ROWID;

-- 2. Ensure legacy tables exist before migration queries to prevent missing table errors
CREATE TABLE IF NOT EXISTS log_hourly_rollups (profile_id TEXT, hour_timestamp INTEGER, action TEXT, count INTEGER);
CREATE TABLE IF NOT EXISTS domain_hourly_rollups (profile_id TEXT, action TEXT, hour_timestamp INTEGER, domain TEXT, count INTEGER);
CREATE TABLE IF NOT EXISTS client_hourly_rollups (profile_id TEXT, hour_timestamp INTEGER, client_ip TEXT, geo_country TEXT, access_point_id TEXT, count INTEGER);
CREATE TABLE IF NOT EXISTS destination_hourly_rollups (profile_id TEXT, hour_timestamp INTEGER, country_code TEXT, country TEXT, access_point_id TEXT, count INTEGER);

-- 3. Consolidate existing historical data from legacy tables
INSERT OR IGNORE INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
SELECT profile_id, 'action', hour_timestamp, action, '', '', count
FROM log_hourly_rollups
WHERE profile_id IS NOT NULL;

INSERT OR IGNORE INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
SELECT profile_id, 'domain', hour_timestamp, domain, action, '', count
FROM domain_hourly_rollups
WHERE profile_id IS NOT NULL;

INSERT OR IGNORE INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
SELECT profile_id, 'client', hour_timestamp, client_ip, geo_country, access_point_id, count
FROM client_hourly_rollups
WHERE profile_id IS NOT NULL;

INSERT OR IGNORE INTO hourly_rollups (profile_id, metric_type, hour_timestamp, key, sub_key, access_point_id, count)
SELECT profile_id, 'dest', hour_timestamp, country_code, country, access_point_id, count
FROM destination_hourly_rollups
WHERE profile_id IS NOT NULL;

-- 4. Drop legacy separated rollup tables
DROP TABLE IF EXISTS log_hourly_rollups;
DROP TABLE IF EXISTS domain_hourly_rollups;
DROP TABLE IF EXISTS client_hourly_rollups;
DROP TABLE IF EXISTS destination_hourly_rollups;
