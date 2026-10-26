-- Migration 0059: Restore hourly rollup tables for high-performance dashboard analytics
-- Re-establishes log_hourly_rollups, client_hourly_rollups, destination_hourly_rollups, and domain_hourly_rollups.
-- Reduces query latency and row read amplification by >99% on dashboard analytics.

-- 1. log_hourly_rollups
CREATE TABLE IF NOT EXISTS log_hourly_rollups (
    profile_id TEXT NOT NULL,
    hour_timestamp INTEGER NOT NULL,
    action TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, hour_timestamp, action)
);

-- 2. client_hourly_rollups
CREATE TABLE IF NOT EXISTS client_hourly_rollups (
    profile_id TEXT NOT NULL,
    hour_timestamp INTEGER NOT NULL,
    client_ip TEXT NOT NULL,
    geo_country TEXT NOT NULL DEFAULT '',
    access_point_id TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, hour_timestamp, client_ip, geo_country, access_point_id)
);

-- 3. destination_hourly_rollups
CREATE TABLE IF NOT EXISTS destination_hourly_rollups (
    profile_id TEXT NOT NULL,
    hour_timestamp INTEGER NOT NULL,
    country_code TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT '',
    access_point_id TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, hour_timestamp, country_code, country, access_point_id)
);

-- 4. domain_hourly_rollups (clustered WITHOUT ROWID for write efficiency)
CREATE TABLE IF NOT EXISTS domain_hourly_rollups (
    profile_id TEXT NOT NULL,
    action TEXT NOT NULL,
    hour_timestamp INTEGER NOT NULL,
    domain TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, action, hour_timestamp, domain)
) WITHOUT ROWID;

