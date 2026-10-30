CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
    setting_data JSON NOT NULL,
    updated_by CHAR(36) NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    CONSTRAINT fk_app_settings_updated_by FOREIGN KEY (updated_by) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
