-- Migration 0058: Add index on kem_keys(created_at) and reinforce idx_logs_kem_key_id
CREATE INDEX IF NOT EXISTS idx_kem_keys_created_at ON kem_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_kem_key_id ON logs(kem_key_id) WHERE kem_key_id IS NOT NULL;
