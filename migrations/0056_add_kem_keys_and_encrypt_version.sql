-- Migration 0056: Add kem_keys table, replace is_encrypted with encrypt_version, add kem_key_id
CREATE TABLE IF NOT EXISTS kem_keys (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    kem_ct TEXT NOT NULL,          -- Base64 encoded P256-MLKEM768 ciphertext (1153 bytes)
    created_at INTEGER NOT NULL,   -- Second-level epoch timestamp
    expires_at INTEGER NOT NULL,   -- Second-level expiration timestamp
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kem_keys_profile_time ON kem_keys(profile_id, created_at DESC);

-- Alter logs table: add encrypt_version and kem_key_id
ALTER TABLE logs ADD COLUMN encrypt_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE logs ADD COLUMN kem_key_id TEXT REFERENCES kem_keys(id);

-- Backfill legacy is_encrypted logs to encrypt_version = 1
UPDATE logs SET encrypt_version = 1 WHERE is_encrypted = 1;

-- Drop legacy is_encrypted column
ALTER TABLE logs DROP COLUMN is_encrypted;
