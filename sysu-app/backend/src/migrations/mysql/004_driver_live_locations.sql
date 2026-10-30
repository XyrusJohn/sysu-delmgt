CREATE TABLE IF NOT EXISTS app_driver_live_locations (
  driver_id VARCHAR(128) NOT NULL PRIMARY KEY,
  sap_assignment_id VARCHAR(128) NULL,
  display_name VARCHAR(160) NOT NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  status VARCHAR(32) NOT NULL,
  sampled_at_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  received_at_ms BIGINT UNSIGNED NOT NULL,
  offline_since_ms BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_app_driver_live_locations_status (status),
  INDEX idx_app_driver_live_locations_received (received_at_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
