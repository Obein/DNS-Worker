-- Migration 0040: Reduce logs index write amplification from 4 to 2 rows per insert
-- Drops secondary action and access point indexes; retains single primary (profile_id, timestamp) index.
-- This reduces D1 write rows per DNS log insert/delete by 50% and lowers database storage usage.

DROP INDEX IF EXISTS idx_logs_profile_ap_time;
DROP INDEX IF EXISTS idx_logs_profile_action_time;

-- Ensure baseline profile time index is present for time-range filtering, pagination, and cleanup
CREATE INDEX IF NOT EXISTS idx_logs_profile_time ON logs(profile_id, timestamp);
