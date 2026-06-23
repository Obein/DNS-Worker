-- Add session_id column to user_activity_log table
ALTER TABLE user_activity_log ADD COLUMN session_id TEXT;
