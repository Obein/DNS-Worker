-- Migration 0062: Add AdGuard format rules storage and custom rule subdomain matching support

-- 1. Add include_subdomains column to custom rules table (default 0 / exact match only)
ALTER TABLE rules ADD COLUMN include_subdomains INTEGER DEFAULT 0;

-- 2. Create list_adguard_rules table for list-level AdGuard payloads
CREATE TABLE IF NOT EXISTS list_adguard_rules (
    list_id INTEGER PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
);

-- 3. Create profile_adguard_rules table for active profile AdGuard engine
CREATE TABLE IF NOT EXISTS profile_adguard_rules (
    profile_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- 4. Create profile_adguard_rules_staging table for transaction-safe promotion
CREATE TABLE IF NOT EXISTS profile_adguard_rules_staging (
    profile_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
