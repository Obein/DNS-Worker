-- Add profile_key column to profiles table
ALTER TABLE profiles ADD COLUMN profile_key TEXT;

-- Backfill profile_key with existing id for backward compatibility
UPDATE profiles SET profile_key = LOWER(id) WHERE profile_key IS NULL;

-- Create unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_key ON profiles(profile_key);
