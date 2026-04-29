-- Incremental DDL for case-insensitive uniqueness on users.username (issue #8).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is the manual-apply reference for existing databases (prod / preview branches).
--
-- Scope: username only.
--   * Email: the existing column-level unique constraint (`users_email_unique`) is
--     kept as-is. The signup route normalizes email to lowercase on insert and
--     every lookup uses the lowercased value, so the case-sensitive btree is
--     effectively case-insensitive AND backs the equality lookups in
--     login / password-reset / signup pre-check (no sequential scan regression).
--   * Username: display case is preserved in storage; uniqueness is enforced
--     case-insensitively via a functional `lower(username)` index.
--
-- Pre-flight (RUN FIRST against the target DB; must return 0 rows):
--   SELECT lower(username) AS dup, count(*) FROM users GROUP BY 1 HAVING count(*) > 1;
-- If rows are returned, resolve the duplicates out-of-band before continuing —
-- the index build below will fail on conflicting rows and roll back the txn.
--
-- This script is idempotent (IF EXISTS / IF NOT EXISTS) and atomic (BEGIN/COMMIT
-- so a failure mid-flight rolls the legacy constraint back into place).

BEGIN;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower_unique"
  ON "users" (lower("username"));

COMMIT;
