-- Migration 0067: Add user-level filter lists and profile override tables
--
-- 1. user_lists: Stores User-level filter lists (both user-created and system-distributed)
--    which apply to all profiles belonging to that user.
-- 2. profile_user_list_overrides: Allows enabling/disabling a user-level or system-level
--    list for a specific profile without deleting it.

CREATE TABLE IF NOT EXISTS user_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    url TEXT NOT NULL,
    is_system INTEGER DEFAULT 0, -- 0: User-created, 1: System-distributed
    enabled INTEGER DEFAULT 1,    -- Default enabled state for the user
    created_at INTEGER NOT NULL,  -- Integer Unix timestamp in seconds
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_user_lists_user_id ON user_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_user_lists_url ON user_lists(url);

CREATE TABLE IF NOT EXISTS profile_user_list_overrides (
    profile_id TEXT NOT NULL,
    user_list_id INTEGER NOT NULL,
    enabled INTEGER NOT NULL,     -- 0: Disabled for this profile, 1: Enabled
    updated_at INTEGER NOT NULL,  -- Integer Unix timestamp in seconds
    PRIMARY KEY (profile_id, user_list_id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (user_list_id) REFERENCES user_lists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pulo_profile_id ON profile_user_list_overrides(profile_id);

-- Backfill legacy system lists from lists table to user_lists
INSERT OR IGNORE INTO user_lists (user_id, url, is_system, enabled, created_at)
SELECT DISTINCT p.owner_id, l.url, 1, 1, strftime('%s', 'now')
FROM lists l
JOIN profiles p ON l.profile_id = p.id
WHERE l.is_system = 1;

-- Backfill any per-profile disabled state for migrated system lists
INSERT OR IGNORE INTO profile_user_list_overrides (profile_id, user_list_id, enabled, updated_at)
SELECT l.profile_id, ul.id, l.enabled, strftime('%s', 'now')
FROM lists l
JOIN profiles p ON l.profile_id = p.id
JOIN user_lists ul ON ul.user_id = p.owner_id AND ul.url = l.url
WHERE l.is_system = 1 AND l.enabled = 0;

-- Remove migrated system lists from profile-level lists table
DELETE FROM lists WHERE is_system = 1;
