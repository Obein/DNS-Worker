-- Migration 0064: Globalize compiled filter lists storage and metadata

-- 1. Create global list metadata table
CREATE TABLE IF NOT EXISTS global_list_metadata (
    url TEXT PRIMARY KEY,
    etag TEXT,
    last_modified TEXT,
    last_synced_at INTEGER,
    sync_error TEXT,
    created_at INTEGER NOT NULL
);

-- 2. Create global list bloom filter chunks table
CREATE TABLE IF NOT EXISTS global_list_blooms (
    url TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    bloom_filter_chunk BLOB NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (url, chunk_index),
    FOREIGN KEY (url) REFERENCES global_list_metadata(url) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_global_list_blooms_url ON global_list_blooms(url);

-- 3. Create global list AdGuard rules payload table
CREATE TABLE IF NOT EXISTS global_list_adguard_rules (
    url TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (url) REFERENCES global_list_metadata(url) ON DELETE CASCADE
);

-- 4. Backfill existing lists data into global tables
INSERT OR IGNORE INTO global_list_metadata (url, etag, last_modified, last_synced_at, sync_error, created_at)
SELECT url, etag, last_modified, last_synced_at, sync_error, strftime('%s', 'now')
FROM lists
GROUP BY url;

INSERT OR IGNORE INTO global_list_blooms (url, chunk_index, bloom_filter_chunk, updated_at)
SELECT l.url, lb.chunk_index, lb.bloom_filter_chunk, lb.updated_at
FROM list_blooms lb
JOIN lists l ON lb.list_id = l.id;

INSERT OR IGNORE INTO global_list_adguard_rules (url, payload, updated_at)
SELECT l.url, ar.payload, ar.updated_at
FROM list_adguard_rules ar
JOIN lists l ON ar.list_id = l.id;

-- 5. Drop old redundant per-list bloom and rule tables to reclaim storage
DROP TABLE IF EXISTS list_blooms;
DROP TABLE IF EXISTS list_adguard_rules;
