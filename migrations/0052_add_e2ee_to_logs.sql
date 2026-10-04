-- Migration 0052: Add E2EE columns to logs table
-- is_encrypted: 1 if payload is encrypted with user's E2EE public key, 0 otherwise
-- encrypted_payload: JSON string containing ephemeral public key, IV, ciphertext, and auth tag

ALTER TABLE logs ADD COLUMN is_encrypted INTEGER DEFAULT 0;
ALTER TABLE logs ADD COLUMN encrypted_payload TEXT;
