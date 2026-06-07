DROP TABLE IF EXISTS profile_blooms;

CREATE TABLE profile_blooms (
  profile_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  bloom_filter_chunk BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, chunk_index)
);
