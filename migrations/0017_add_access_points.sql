-- Create access_points table
CREATE TABLE IF NOT EXISTS access_points (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_points_profile ON access_points(profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_points_token ON access_points(token);

-- Backfill access points for existing profiles
-- We use lower(hex(randomblob(6))) to generate a 12-character hex ID for each existing profile's default access point
INSERT INTO access_points (id, profile_id, name, token, created_at, updated_at)
SELECT 
    lower(hex(randomblob(6))), 
    id, 
    'Device-1', 
    COALESCE(profile_key, lower(id)), 
    created_at, 
    updated_at
FROM profiles;

-- Alter logs table to add access_point_id
ALTER TABLE logs ADD COLUMN access_point_id TEXT REFERENCES access_points(id) ON DELETE SET NULL;

-- Create an index to speed up log filtering by access point
CREATE INDEX IF NOT EXISTS idx_logs_access_point ON logs(access_point_id);
