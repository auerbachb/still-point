-- #948: replay key for POST /api/thoughts/batch. The web offline queue mints one
-- for each in-session thought when it queues the sit and sends it on every
-- upload, so a batch sent again after its response was lost (the #907 upload
-- deadline, or a dropped connection) stores each thought once. Nullable:
-- completion notes, iOS, and thoughts queued before #948 send none and are
-- stored as before.
-- Depends only on "thoughts" (created by 0_core_tables_incremental.sql), so its
-- place in the runner's order does not matter.
-- Idempotent + safe to re-run. Do NOT edit after it is applied (the
-- schema_migrations checksum ledger will reject a changed body).

ALTER TABLE "thoughts"
  ADD COLUMN IF NOT EXISTS "client_thought_id" uuid;

-- Partial unique index (non-CONCURRENTLY): incremental migrations run inside the
-- apply-migrations outer transaction, which cannot wrap CREATE INDEX CONCURRENTLY.
-- The column is new, so no stored row can violate it; re-run is idempotent via
-- IF NOT EXISTS. User-scoped like sessions_user_client_session_unique (#557).
CREATE UNIQUE INDEX IF NOT EXISTS "thoughts_user_client_thought_unique"
  ON "thoughts" ("user_id", "client_thought_id")
  WHERE "client_thought_id" IS NOT NULL;
