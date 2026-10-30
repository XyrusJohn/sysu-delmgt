-- Add username login while preserving existing email-only account rows.
ALTER TABLE app_auth_users
    MODIFY COLUMN email VARCHAR(254) NULL,
    MODIFY COLUMN email_normalized VARCHAR(254) NULL,
    ADD COLUMN username VARCHAR(32) NULL AFTER firebase_uid,
    ADD COLUMN username_normalized VARCHAR(32) NULL AFTER username,
    ADD UNIQUE KEY uq_app_auth_users_username (username_normalized);

ALTER TABLE app_auth_identities
    DROP CHECK chk_app_auth_identity_provider,
    ADD CONSTRAINT chk_app_auth_identity_provider CHECK (provider IN ('email', 'username', 'google')),
    DROP CHECK chk_app_auth_identity_password,
    ADD CONSTRAINT chk_app_auth_identity_password CHECK (
        (provider IN ('email', 'username') AND password_hash IS NOT NULL)
        OR (provider = 'google' AND password_hash IS NULL)
    );
