-- Migration 0046: Add passkeys table for WebAuthn/FIDO2 MFA authentication

CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    algorithm INTEGER NOT NULL DEFAULT -7,
    sign_count INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    aaguid TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_passkeys_credential ON passkeys(credential_id);
