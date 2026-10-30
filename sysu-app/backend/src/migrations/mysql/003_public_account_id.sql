-- Give accounts a stable non-enumerable identifier before clients leave Firebase UIDs.
ALTER TABLE app_auth_users ADD COLUMN public_id CHAR(36) NULL AFTER id;
UPDATE app_auth_users SET public_id = UUID() WHERE public_id IS NULL;
ALTER TABLE app_auth_users
    MODIFY COLUMN public_id CHAR(36) NOT NULL,
    ADD UNIQUE KEY uq_app_auth_users_public_id (public_id);
