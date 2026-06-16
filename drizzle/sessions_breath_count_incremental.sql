-- #374: tap-to-breathe breath-counting sessions.
-- Allow the 'breath' session type and add the nullable breath_count column.
-- Idempotent + safe to re-run on hand-migrated databases (matches the runner
-- contract in scripts/apply-migrations.ts). Do NOT edit after it is applied
-- (the schema_migrations checksum ledger will reject a changed body).

ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "breath_count" integer;

-- Relax the session-type CHECK to include 'breath'. DROP+ADD is idempotent and
-- order-independent vs. sessions_session_type_incremental.sql, whose own ADD is
-- guarded by IF NOT EXISTS and therefore cannot downgrade this 3-value form.
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_session_type_allowed";
ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_session_type_allowed"
CHECK ("session_type" in ('standard', 'quick', 'breath'));
