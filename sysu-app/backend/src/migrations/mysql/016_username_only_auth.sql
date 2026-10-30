-- Drop Firebase-era identity options after the startup preflight verifies rows.
ALTER TABLE app_auth_identities
    DROP CHECK chk_app_auth_identity_provider,
    ADD CONSTRAINT chk_app_auth_identity_provider CHECK (provider = 'username'),
    DROP CHECK chk_app_auth_identity_password,
    ADD CONSTRAINT chk_app_auth_identity_password CHECK (password_hash IS NOT NULL);

ALTER TABLE app_auth_users
    DROP INDEX uq_app_auth_users_firebase_uid,
    DROP COLUMN firebase_uid;
