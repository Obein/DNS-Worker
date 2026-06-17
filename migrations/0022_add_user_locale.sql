-- Add locale column to users table for customized date and time formatting
ALTER TABLE users ADD COLUMN locale TEXT DEFAULT 'en-US';
