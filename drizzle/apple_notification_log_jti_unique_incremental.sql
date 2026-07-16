-- Issue #532: replay guard for Apple server-to-server notifications.
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is the manual-apply reference for existing databases (prod / preview branches)
-- and is what `scripts/apply-migrations.ts` runs automatically on every deploy.
--
-- Invariant: each JWT `jti` is recorded at most once. Replayed notifications with
-- the same `jti` are deduplicated at insert time and must not re-trigger handlers.
-- A partial unique index is used because `jti` is nullable — legacy/malformed tokens
-- may omit it and must remain insertable without colliding with each other.
--
-- Pre-flight (RUN FIRST against the target DB, read-only; must return 0 rows):
--   SELECT jti, count(*)
--   FROM apple_notification_log
--   WHERE jti IS NOT NULL
--   GROUP BY 1
--   HAVING count(*) > 1;
-- Duplicate `jti` rows MUST be deduped before this migration reaches the branch,
-- or the unique index build below fails and rolls back the transaction.
--
-- This script is idempotent (IF NOT EXISTS) and is wrapped in a transaction by the
-- migration runner, so a failure mid-flight rolls back cleanly.
--
-- Lock note: CREATE UNIQUE INDEX (non-CONCURRENTLY) takes SHARE on
-- apple_notification_log for the duration of the build, blocking concurrent writes.
-- This is fine on the current small table (sub-second build). The runner executes
-- inside a transaction, so CONCURRENTLY is not an option here.

CREATE UNIQUE INDEX IF NOT EXISTS "apple_notification_log_jti_unique"
  ON "apple_notification_log" ("jti")
  WHERE "jti" IS NOT NULL;
