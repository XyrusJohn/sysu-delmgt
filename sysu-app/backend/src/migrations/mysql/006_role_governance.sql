CREATE TABLE IF NOT EXISTS app_role_requests (
    id CHAR(36) NOT NULL PRIMARY KEY,
    requester_id CHAR(36) NOT NULL,
    requester_name VARCHAR(100) NOT NULL,
    requester_email VARCHAR(254) NULL,
    current_role VARCHAR(32) NOT NULL,
    requested_role VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    reviewer_id CHAR(36) NULL,
    rejection_reason VARCHAR(1000) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at DATETIME(3) NULL,
    pending_requester_id CHAR(36) GENERATED ALWAYS AS (CASE WHEN status = 'pending' THEN requester_id ELSE NULL END) STORED,
    UNIQUE KEY uq_app_role_requests_pending_requester (pending_requester_id),
    KEY idx_app_role_requests_status_created (status, created_at),
    CONSTRAINT fk_app_role_requests_requester FOREIGN KEY (requester_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_role_requests_reviewer FOREIGN KEY (reviewer_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT chk_app_role_requests_status CHECK (status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT chk_app_role_requests_role CHECK (requested_role IN ('pending', 'driver', 'fleet_manager', 'qr_generator', 'admin', 'super_admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_user_admin_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    actor_id CHAR(36) NOT NULL,
    target_id CHAR(36) NOT NULL,
    action VARCHAR(40) NOT NULL,
    details JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_app_user_admin_audit_target_created (target_id, created_at),
    CONSTRAINT fk_app_user_admin_audit_actor FOREIGN KEY (actor_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_user_admin_audit_target FOREIGN KEY (target_id) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
