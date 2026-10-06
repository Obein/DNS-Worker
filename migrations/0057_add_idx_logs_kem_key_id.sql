-- Migration 0057: Add index on logs(kem_key_id) for orphan kem_keys cleanup and decryption joins
CREATE INDEX IF NOT EXISTS idx_logs_kem_key_id ON logs(kem_key_id) WHERE kem_key_id IS NOT NULL;
