-- Migration 0069: Drop redundant secondary indexes on logs to eliminate write amplification
-- Drops single-column idx_logs_domain and idx_logs_access_point.
-- Core log queries and retention purges use composite primary key (profile_id, timestamp, id)
-- or idx_logs_profile_time, cutting write amplification per DNS log insert by ~50%.

DROP INDEX IF EXISTS idx_logs_domain;
DROP INDEX IF EXISTS idx_logs_access_point;
