-- Keep removal-request audit records after an approved request deletes its session.
SET @driver_action_delete_fk_exists = (
    SELECT COUNT(*)
      FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'app_driver_action_delete_requests'
       AND CONSTRAINT_NAME = 'fk_app_driver_action_delete_session'
);
SET @driver_action_delete_fk_sql = IF(
    @driver_action_delete_fk_exists > 0,
    'ALTER TABLE app_driver_action_delete_requests DROP FOREIGN KEY fk_app_driver_action_delete_session',
    'SELECT 1'
);
PREPARE driver_action_delete_fk_stmt FROM @driver_action_delete_fk_sql;
EXECUTE driver_action_delete_fk_stmt;
DEALLOCATE PREPARE driver_action_delete_fk_stmt;
