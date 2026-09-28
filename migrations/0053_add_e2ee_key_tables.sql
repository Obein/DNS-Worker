-- Migration 0053: Add E2EE key management tables
-- 1. Profile Public Key (used by Worker edge to encrypt DNS logs)
CREATE TABLE IF NOT EXISTS user_log_keys (
    profile_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- 2. Passkey Wrapped Private Keys (Envelope encryption: SK_log wrapped with Passkey KEK)
CREATE TABLE IF NOT EXISTS user_passkey_wrapped_keys (
    passkey_id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    encrypted_sk TEXT NOT NULL,
    iv TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (passkey_id) REFERENCES passkeys(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkey_wrapped_profile ON user_passkey_wrapped_keys(profile_id);

-- 3. Recovery Wrapped Private Keys (Envelope encryption fallback: SK_log wrapped with Recovery Key KEK)
CREATE TABLE IF NOT EXISTS user_recovery_wrapped_keys (
    profile_id TEXT PRIMARY KEY,
    encrypted_sk TEXT NOT NULL,
    iv TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
