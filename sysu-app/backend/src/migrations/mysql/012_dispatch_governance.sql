CREATE TABLE IF NOT EXISTS app_dispatch_requests (
    request_id CHAR(36) NOT NULL PRIMARY KEY,
    request_kind VARCHAR(16) NOT NULL,
    dispatch_key VARCHAR(128) NOT NULL,
    requested_driver_id CHAR(36) NULL,
    reason VARCHAR(2000) NOT NULL,
    requested_by CHAR(36) NOT NULL,
    requested_at_ms BIGINT UNSIGNED NOT NULL,
    status VARCHAR(16) NOT NULL,
    decided_by CHAR(36) NULL,
    decided_at_ms BIGINT UNSIGNED NULL,
    decision VARCHAR(16) NULL,
    deny_reason VARCHAR(2000) NULL,
    token_id CHAR(36) NULL,
    token_expires_at_ms BIGINT UNSIGNED NULL,
    assignment_assigned_at_ms BIGINT UNSIGNED NULL,
    request_data JSON NOT NULL,
    pending_scope VARCHAR(160) GENERATED ALWAYS AS
      (CASE WHEN status = 'pending' THEN CONCAT(request_kind, ':', dispatch_key) ELSE NULL END) STORED,
    UNIQUE KEY uq_app_dispatch_requests_pending_scope (pending_scope),
    KEY idx_app_dispatch_requests_status_time (request_kind, status, requested_at_ms),
    KEY idx_app_dispatch_requests_requester (requested_by, requested_at_ms),
    CONSTRAINT chk_app_dispatch_requests_kind CHECK (request_kind IN ('override', 'cancel')),
    CONSTRAINT chk_app_dispatch_requests_status CHECK (status IN ('pending', 'approved', 'denied', 'revoked', 'completed', 'expired')),
    CONSTRAINT fk_app_dispatch_requests_driver FOREIGN KEY (requested_driver_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_dispatch_requests_requester FOREIGN KEY (requested_by) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_dispatch_requests_reviewer FOREIGN KEY (decided_by) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_override_tokens (
    token_id CHAR(36) NOT NULL PRIMARY KEY,
    request_id CHAR(36) NOT NULL,
    dispatch_key VARCHAR(128) NOT NULL,
    requested_driver_id CHAR(36) NOT NULL,
    reason VARCHAR(2000) NOT NULL,
    issued_by CHAR(36) NOT NULL,
    issued_at_ms BIGINT UNSIGNED NOT NULL,
    expires_at_ms BIGINT UNSIGNED NOT NULL,
    consumed_at_ms BIGINT UNSIGNED NULL,
    consumed_by CHAR(36) NULL,
    consumed_for_assignment VARCHAR(128) NULL,
    UNIQUE KEY uq_app_override_tokens_request (request_id),
    KEY idx_app_override_tokens_expiry (expires_at_ms),
    CONSTRAINT fk_app_override_tokens_request FOREIGN KEY (request_id) REFERENCES app_dispatch_requests (request_id),
    CONSTRAINT fk_app_override_tokens_driver FOREIGN KEY (requested_driver_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_override_tokens_issuer FOREIGN KEY (issued_by) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_override_tokens_consumer FOREIGN KEY (consumed_by) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_sap_assignment_history (
    request_id CHAR(36) NOT NULL PRIMARY KEY,
    dispatch_key VARCHAR(128) NOT NULL,
    driver_id CHAR(36) NOT NULL,
    cancelled_by CHAR(36) NOT NULL,
    cancelled_at_ms BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(2000) NOT NULL,
    assignment_data JSON NOT NULL,
    line_items JSON NOT NULL,
    KEY idx_app_sap_assignment_history_dispatch (dispatch_key, cancelled_at_ms),
    CONSTRAINT fk_app_sap_assignment_history_request FOREIGN KEY (request_id) REFERENCES app_dispatch_requests (request_id),
    CONSTRAINT fk_app_sap_assignment_history_driver FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_sap_assignment_history_actor FOREIGN KEY (cancelled_by) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
