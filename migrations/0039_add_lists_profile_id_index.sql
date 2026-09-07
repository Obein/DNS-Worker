-- Migration 0039: Add indexes to optimize list sync target queries
-- Accelerates list sync target lookup in profiles and existence check on lists

CREATE INDEX IF NOT EXISTS idx_profiles_list_updated_at ON profiles(list_updated_at);
CREATE INDEX IF NOT EXISTS idx_lists_profile_id ON lists(profile_id);
