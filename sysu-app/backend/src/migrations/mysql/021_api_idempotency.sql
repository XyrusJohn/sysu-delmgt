CREATE TABLE IF NOT EXISTS app_api_idempotency (
    service_name VARCHAR(32) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    request_key VARCHAR(80) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    operation_name VARCHAR(255) NOT NULL,
    state ENUM('processing', 'completed') NOT NULL,
    response_status SMALLINT UNSIGNED NULL,
    response_body MEDIUMTEXT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (service_name, actor_id, request_key),
    KEY idx_app_api_idempotency_state_time (state, updated_at_ms),
    CONSTRAINT chk_app_api_idempotency_response CHECK (
        (state = 'processing' AND response_status IS NULL AND response_body IS NULL)
        OR (state = 'completed' AND response_status IS NOT NULL AND response_body IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
