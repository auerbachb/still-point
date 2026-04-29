-- Incremental DDL: make users.password_hash nullable (issue #136).
-- OAuth-only accounts (e.g., Google sign-in with no password ever set) need
-- the column to be NULL. The login route refuses logins for users with a
-- NULL password_hash and prompts them to use OAuth instead.
--
-- Idempotent: DROP NOT NULL is a no-op if already nullable.

BEGIN;

ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

COMMIT;
