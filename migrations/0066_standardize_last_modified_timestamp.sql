-- Migration 0066: Standardize global_list_metadata last_modified column to integer Unix timestamp

CREATE TABLE IF NOT EXISTS global_list_metadata_new (
    url TEXT PRIMARY KEY,
    etag TEXT,
    last_modified INTEGER,
    last_synced_at INTEGER,
    sync_error TEXT,
    created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO global_list_metadata_new (url, etag, last_modified, last_synced_at, sync_error, created_at)
SELECT
    url,
    etag,
    CASE
        WHEN typeof(last_modified) = 'integer' THEN last_modified
        WHEN typeof(last_modified) = 'text' AND last_modified GLOB '[0-9]*' THEN CAST(last_modified AS INTEGER)
        ELSE NULL
    END,
    last_synced_at,
    sync_error,
    created_at
FROM global_list_metadata;

DROP TABLE global_list_metadata;
ALTER TABLE global_list_metadata_new RENAME TO global_list_metadata;

-- Sanitize legacy lists table column values if present
UPDATE lists
SET last_modified = NULL
WHERE last_modified IS NOT NULL AND typeof(last_modified) != 'integer' AND last_modified NOT GLOB '[0-9]*';
