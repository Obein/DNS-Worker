-- Migration 0047: Add passkey actions to user_activity_log CHECK constraint

PRAGMA foreign_keys=off;

CREATE TABLE user_activity_log_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN (
        'signup', 'login_success', 'login_fail', 'logout',
        'password_change_success', 'password_change_fail',
        'totp_verify_success', 'totp_verify_fail',
        'totp_setup', 'totp_removed',
        'recovery_key_used', 'session_revoked',
        'pin_verify_success', 'pin_verify_fail',
        'passkey_registered', 'passkey_deleted',
        'passkey_verify_success', 'passkey_verify_fail'
    )),
    ip_address TEXT,
    user_agent TEXT,
    timestamp INTEGER NOT NULL,
    extra TEXT,
    session_id_hash TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO user_activity_log_new (id, user_id, action, ip_address, user_agent, timestamp, extra, session_id_hash)
SELECT id, user_id, action, ip_address, user_agent, timestamp, extra, session_id_hash FROM user_activity_log;

DROP TABLE user_activity_log;

ALTER TABLE user_activity_log_new RENAME TO user_activity_log;

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON user_activity_log(user_id, timestamp DESC);

PRAGMA foreign_keys=on;
