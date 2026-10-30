CREATE TABLE IF NOT EXISTS app_pod_groups (
    id CHAR(64) NOT NULL PRIMARY KEY,
    dispatch_key VARCHAR(128) NOT NULL,
    capture_id VARCHAR(64) NOT NULL,
    driver_id CHAR(36) NOT NULL,
    image_data LONGTEXT NOT NULL,
    captured_at_ms BIGINT UNSIGNED NOT NULL,
    recorded_at_ms BIGINT UNSIGNED NOT NULL,
    delivery_status VARCHAR(32) NOT NULL,
    obd_numbers JSON NOT NULL,
    UNIQUE KEY uq_app_pod_group_capture (driver_id, dispatch_key, capture_id),
    CONSTRAINT fk_app_pod_groups_assignment FOREIGN KEY (dispatch_key) REFERENCES app_sap_assignments (dispatch_key) ON DELETE CASCADE,
    CONSTRAINT fk_app_pod_groups_driver FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_pod_images (
    dispatch_key VARCHAR(128) NOT NULL,
    obd_number VARCHAR(100) NOT NULL,
    group_pod_id CHAR(64) NULL,
    driver_id CHAR(36) NOT NULL,
    image_data LONGTEXT NULL,
    captured_at_ms BIGINT UNSIGNED NULL,
    recorded_at_ms BIGINT UNSIGNED NOT NULL,
    delivery_status VARCHAR(32) NULL,
    PRIMARY KEY (dispatch_key, obd_number),
    KEY idx_app_pod_images_group (group_pod_id),
    CONSTRAINT fk_app_pod_images_assignment FOREIGN KEY (dispatch_key) REFERENCES app_sap_assignments (dispatch_key) ON DELETE CASCADE,
    CONSTRAINT fk_app_pod_images_driver FOREIGN KEY (driver_id) REFERENCES app_auth_users (public_id),
    CONSTRAINT fk_app_pod_images_group FOREIGN KEY (group_pod_id) REFERENCES app_pod_groups (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
