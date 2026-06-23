-- Rename session_id column to session_id_hash in user_activity_log table
ALTER TABLE user_activity_log RENAME COLUMN session_id TO session_id_hash;
