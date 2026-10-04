-- Migration 0055: Add is_active column to user_log_keys to allow toggling E2EE on/off without destroying keys
ALTER TABLE user_log_keys ADD COLUMN is_active INTEGER DEFAULT 1;
