-- Migration 0063: Add HTTP ETag and Last-Modified headers to lists table for conditional request (304 Not Modified) optimization

ALTER TABLE lists ADD COLUMN etag TEXT;
ALTER TABLE lists ADD COLUMN last_modified TEXT;
