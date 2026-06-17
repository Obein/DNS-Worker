-- Add timezone column to users table for customized time formatting
ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT NULL;
