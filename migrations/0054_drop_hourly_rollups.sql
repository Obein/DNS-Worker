-- Migration 0054: Drop obsolete hourly rollup tables
-- Rollup aggregation has been replaced by client-side Local-First analytics (SQLite WASM)
-- and direct clustered-index queries on logs for server-side fallback.
-- Drops domain_hourly_rollups, log_hourly_rollups, client_hourly_rollups, destination_hourly_rollups.

DROP TABLE IF EXISTS domain_hourly_rollups;
DROP TABLE IF EXISTS log_hourly_rollups;
DROP TABLE IF EXISTS client_hourly_rollups;
DROP TABLE IF EXISTS destination_hourly_rollups;

-- Remove obsolete rollup watermark from system settings
DELETE FROM system_settings WHERE key = 'last_hourly_rollup_timestamp';
