CREATE TABLE IF NOT EXISTS app_driver_action_sessions (
    session_id CHAR(36) NOT NULL PRIMARY KEY,
    driver_id CHAR(36) NOT NULL,
    status VARCHAR(16) NOT NULL,
    started_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    last_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
    completed_at_ms BIGINT UNSIGNED NULL,
    expires_at_ms BIGINT UNSIGNED NOT NULL,
    deleted_at_ms BIGINT UNSIGNED NULL,
    deleted_by CHAR(36) NULL,
    pending_deletion_request_id CHAR(36) NULL,
    data JSON NOT NULL,
    KEY idx_app_driver_action_sessions_driver_started (driver_id, started_at_ms),
    KEY idx_app_driver_action_sessions_expiry (expires_at_ms),
    CONSTRAINT fk_app_driver_action_sessions_driver FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_driver_action_events (
    event_id CHAR(36) NOT NULL PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    driver_id CHAR(36) NOT NULL,
    sequence_no BIGINT UNSIGNED NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    occurred_at_ms BIGINT UNSIGNED NOT NULL,
    received_at_ms BIGINT UNSIGNED NOT NULL,
    expires_at_ms BIGINT UNSIGNED NOT NULL,
    data JSON NOT NULL,
    UNIQUE KEY uq_app_driver_action_session_sequence (session_id, sequence_no),
    KEY idx_app_driver_action_events_read (driver_id, session_id, sequence_no),
    KEY idx_app_driver_action_events_expiry (expires_at_ms),
    CONSTRAINT fk_app_driver_action_events_session FOREIGN KEY (session_id) REFERENCES app_driver_action_sessions (session_id) ON DELETE CASCADE,
    CONSTRAINT fk_app_driver_action_events_driver FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_driver_action_delete_requests (
    request_id CHAR(36) NOT NULL PRIMARY KEY,
    driver_id CHAR(36) NOT NULL,
    session_id CHAR(36) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    requested_by CHAR(36) NOT NULL,
    requested_by_role VARCHAR(32) NOT NULL,
    requested_at_ms BIGINT UNSIGNED NOT NULL,
    status VARCHAR(16) NOT NULL,
    decided_by CHAR(36) NULL,
    decided_by_role VARCHAR(32) NULL,
    decided_at_ms BIGINT UNSIGNED NULL,
    decision_reason VARCHAR(500) NULL,
    KEY idx_app_driver_action_delete_queue (status, requested_at_ms),
    CONSTRAINT fk_app_driver_action_delete_driver FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_driver_action_delete_session FOREIGN KEY (session_id) REFERENCES app_driver_action_sessions (session_id),
    CONSTRAINT fk_app_driver_action_delete_requester FOREIGN KEY (requested_by) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_driver_action_delete_reviewer FOREIGN KEY (decided_by) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
