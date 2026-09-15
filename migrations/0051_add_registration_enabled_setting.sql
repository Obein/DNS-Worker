-- 系统全局配置：添加注册开关（默认开启 'true'，兼容历史行为）
INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES ('registration_enabled', 'true', 0);
