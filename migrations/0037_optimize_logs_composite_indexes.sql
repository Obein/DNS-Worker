-- 1. Composite indexes for high-frequency log filtering with time ordering
-- Access point filtering
CREATE INDEX IF NOT EXISTS idx_logs_profile_ap_time ON logs(profile_id, access_point_id, timestamp);

-- Action / status filtering (PASS, BLOCK, etc.)
CREATE INDEX IF NOT EXISTS idx_logs_profile_action_time ON logs(profile_id, action, timestamp);

-- Client geo-country filtering
CREATE INDEX IF NOT EXISTS idx_logs_profile_geo_time ON logs(profile_id, geo_country, timestamp);

-- Block / allow reason filtering
CREATE INDEX IF NOT EXISTS idx_logs_profile_reason_time ON logs(profile_id, reason, timestamp);

-- Exact domain filtering per profile
CREATE INDEX IF NOT EXISTS idx_logs_profile_domain_time ON logs(profile_id, domain, timestamp);

-- DNS record type filtering (A, AAAA, HTTPS, etc.)
CREATE INDEX IF NOT EXISTS idx_logs_profile_record_type_time ON logs(profile_id, record_type, timestamp);

-- 2. System indexes to prevent full-table scans during scheduled jobs
-- Profiles list sync ordering index (eliminates full table scan on cron list sync)
CREATE INDEX IF NOT EXISTS idx_profiles_list_updated ON profiles(list_updated_at);

-- Sessions expiration range index (eliminates full table scan on expired sessions purge)
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
