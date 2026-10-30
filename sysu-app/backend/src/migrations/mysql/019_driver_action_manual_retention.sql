-- Driver action history remains available until an administrator removes a session.
ALTER TABLE app_driver_action_sessions
    MODIFY COLUMN expires_at_ms BIGINT UNSIGNED NULL DEFAULT NULL;

ALTER TABLE app_driver_action_events
    MODIFY COLUMN expires_at_ms BIGINT UNSIGNED NULL DEFAULT NULL;

UPDATE app_driver_action_sessions SET expires_at_ms = NULL;
UPDATE app_driver_action_events SET expires_at_ms = NULL;
