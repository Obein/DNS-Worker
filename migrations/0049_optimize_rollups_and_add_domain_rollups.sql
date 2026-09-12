-- Migration 0049: Create domain_hourly_rollups table with zero secondary indexes
-- 1. Primary key prefix (profile_id, action, hour_timestamp, domain) matches exact query patterns.
-- 2. WITHOUT ROWID ensures the table is a clustered B-tree, eliminating write amplification (strict 1-write-per-row).
-- 3. Zero secondary indexes prevents index bloat and doubles write savings.
-- 4. Avoids heavy historical backfills in migration transactions to prevent D1 timeouts and read quota exhaustion.

-- Clean up any experimental secondary indexes if previously created
DROP INDEX IF EXISTS idx_domain_rollups_query;
DROP INDEX IF EXISTS idx_domain_rollups_hour;
DROP INDEX IF EXISTS idx_destination_rollups_hour;
DROP INDEX IF EXISTS idx_log_rollups_hour;
DROP INDEX IF EXISTS idx_client_rollups_hour;

-- Drop legacy table structure if exists during migration development
DROP TABLE IF EXISTS domain_hourly_rollups;

-- Create the lean clustered WITHOUT ROWID rollups table
CREATE TABLE IF NOT EXISTS domain_hourly_rollups (
    profile_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('PASS', 'BLOCK', 'REDIRECT', 'FAIL')),
    hour_timestamp INTEGER NOT NULL,
    domain TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, action, hour_timestamp, domain)
) WITHOUT ROWID;

