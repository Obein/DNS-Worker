-- Migration 0042: Add created_at column to rules table
ALTER TABLE rules ADD COLUMN created_at INTEGER;
UPDATE rules SET created_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE created_at IS NULL;
