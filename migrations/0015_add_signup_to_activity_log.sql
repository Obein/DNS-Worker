PRAGMA foreign_keys=off;

CREATE TABLE user_activity_log_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN (
        'signup',
        'login_success', 'login_fail', 'logout',
        'password_change_success', 'password_change_fail',
        'totp_verify_success', 'totp_verify_fail',
        'totp_setup', 'totp_removed',
        'recovery_key_used',
        'session_revoked'
    )),
    ip_address TEXT,
    user_agent TEXT,
    timestamp INTEGER NOT NULL,
    extra TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO user_activity_log_new SELECT * FROM user_activity_log;

DROP TABLE user_activity_log;

ALTER TABLE user_activity_log_new RENAME TO user_activity_log;

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON user_activity_log(user_id, timestamp DESC);

PRAGMA foreign_keys=on;
