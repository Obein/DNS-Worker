-- Migration 0057: Add encrypted_dek column to kem_keys table for cross-isolate DEK reuse
ALTER TABLE kem_keys ADD COLUMN encrypted_dek TEXT;
