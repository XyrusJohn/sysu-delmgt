-- Shared local auth schema for sysu-app and sysu-go.
-- Apply only to a dedicated local database after reviewing its existing schema.
CREATE TABLE app_auth_users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_id CHAR(36) NOT NULL,
    firebase_uid VARCHAR(128) NULL,
    username VARCHAR(32) NULL,
    username_normalized VARCHAR(32) NULL,
    email VARCHAR(254) NULL,
    email_normalized VARCHAR(254) NULL,
    display_name VARCHAR(100) NOT NULL DEFAULT '',
    role VARCHAR(32) NOT NULL DEFAULT 'pending',
    status VARCHAR(16) NOT NULL DEFAULT 'inactive',
    profile JSON NOT NULL,
    email_verified_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_app_auth_users_public_id (public_id),
    UNIQUE KEY uq_app_auth_users_username (username_normalized),
    UNIQUE KEY uq_app_auth_users_email (email_normalized),
    UNIQUE KEY uq_app_auth_users_firebase_uid (firebase_uid),
    KEY idx_app_auth_users_role_status (role, status),
    CONSTRAINT chk_app_auth_users_role CHECK (role IN ('pending', 'driver', 'fleet_manager', 'qr_generator', 'admin', 'super_admin')),
    CONSTRAINT chk_app_auth_users_status CHECK (status IN ('inactive', 'active', 'disabled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE app_auth_identities (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(16) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_app_auth_identity_subject (provider, provider_subject),
    UNIQUE KEY uq_app_auth_identity_user_provider (user_id, provider),
    CONSTRAINT fk_app_auth_identity_user FOREIGN KEY (user_id) REFERENCES app_auth_users (id) ON DELETE CASCADE,
    CONSTRAINT chk_app_auth_identity_provider CHECK (provider IN ('email', 'username', 'google')),
    CONSTRAINT chk_app_auth_identity_password CHECK (
        (provider IN ('email', 'username') AND password_hash IS NOT NULL)
        OR (provider = 'google' AND password_hash IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE app_auth_sessions (
    token_hash BINARY(32) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    PRIMARY KEY (token_hash),
    KEY idx_app_auth_sessions_user_expiry (user_id, expires_at),
    KEY idx_app_auth_sessions_expiry (expires_at),
    CONSTRAINT fk_app_auth_session_user FOREIGN KEY (user_id) REFERENCES app_auth_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
