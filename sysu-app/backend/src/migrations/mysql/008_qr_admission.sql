CREATE TABLE IF NOT EXISTS app_qr_tokens (
    token VARCHAR(128) NOT NULL PRIMARY KEY,
    expires_at_ms BIGINT UNSIGNED NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    used_by CHAR(36) NULL,
    used_at_ms BIGINT UNSIGNED NULL,
    queue_id VARCHAR(128) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_app_qr_tokens_expiry (expires_at_ms),
    CONSTRAINT fk_app_qr_tokens_used_by FOREIGN KEY (used_by) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_qr_tokens_queue FOREIGN KEY (queue_id) REFERENCES app_queue_entries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_qr_admissions (
    driver_id CHAR(36) NOT NULL PRIMARY KEY,
    queue_id VARCHAR(128) NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    CONSTRAINT fk_app_qr_admissions_driver FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_qr_admissions_queue FOREIGN KEY (queue_id) REFERENCES app_queue_entries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
