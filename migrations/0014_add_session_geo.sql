-- Add latitude and longitude columns to sessions table
ALTER TABLE sessions ADD COLUMN latitude REAL;
ALTER TABLE sessions ADD COLUMN longitude REAL;
