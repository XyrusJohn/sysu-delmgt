CREATE TABLE IF NOT EXISTS app_driver_profiles (
    driver_id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(200) NOT NULL DEFAULT '',
    phone VARCHAR(32) NOT NULL DEFAULT '',
    license VARCHAR(128) NOT NULL DEFAULT '',
    truck_type VARCHAR(64) NOT NULL DEFAULT '',
    plate_number VARCHAR(64) NOT NULL DEFAULT '',
    trucking_company VARCHAR(200) NOT NULL DEFAULT '',
    helper VARCHAR(200) NOT NULL DEFAULT '',
    notes VARCHAR(2000) NOT NULL DEFAULT '',
    is_full BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(32) NOT NULL DEFAULT 'offline',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_app_driver_profiles_user FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_queue_entries (
    id VARCHAR(128) NOT NULL PRIMARY KEY,
    driver_id CHAR(36) NOT NULL,
    driver_name VARCHAR(200) NOT NULL DEFAULT '',
    token VARCHAR(128) NULL,
    truck_type VARCHAR(64) NOT NULL DEFAULT '',
    plate_number VARCHAR(64) NOT NULL DEFAULT '',
    truck_company VARCHAR(200) NOT NULL DEFAULT '',
    helper_name VARCHAR(200) NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL,
    entry_time_ms BIGINT UNSIGNED NOT NULL,
    registration_complete BOOLEAN NOT NULL DEFAULT FALSE,
    is_assigned BOOLEAN NOT NULL DEFAULT FALSE,
    is_full BOOLEAN NOT NULL DEFAULT FALSE,
    data JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    active_driver_id CHAR(36) GENERATED ALWAYS AS (
        CASE WHEN status IN ('waiting', 'called', 'available', 'assigned', 'loading', 'loaded', 'fully_loaded', 'in_transit', 'unloading', 'returning_to_base')
             THEN driver_id ELSE NULL END
    ) STORED,
    UNIQUE KEY uq_app_queue_entries_active_driver (active_driver_id),
    UNIQUE KEY uq_app_queue_entries_token (token),
    KEY idx_app_queue_entries_status_type_time (status, truck_type, entry_time_ms),
    KEY idx_app_queue_entries_driver (driver_id, entry_time_ms),
    CONSTRAINT fk_app_queue_entries_driver FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_driver_profile_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    actor_id CHAR(36) NOT NULL,
    driver_id CHAR(36) NOT NULL,
    action VARCHAR(32) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_app_driver_profile_audit_driver_time (driver_id, created_at),
    CONSTRAINT fk_app_driver_profile_audit_actor FOREIGN KEY (actor_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_driver_profile_audit_driver FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
