-- #835 (focus activity tracking, #765): the 'focus' session type and the
-- per-user focus goal counter. A focus session is a timed single-focus activity,
-- not a meditation sit; `focus_activity_day` steps by one per completed focus
-- session and starts every existing row at 1.
-- Idempotent + safe to re-run. Do NOT edit after it is applied (the
-- schema_migrations checksum ledger will reject a changed body).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "focus_activity_day" integer NOT NULL DEFAULT 1;

-- Widen the session-type CHECK to include 'focus'. This file must sort after
-- sessions_breath_count_incremental.sql, which DROPs and re-ADDs the same
-- constraint with three values and would undo the widening on a fresh database
-- if it ran later. sessions_session_type_incremental.sql (which also sorts
-- earlier) only ADDs the constraint when it is missing.
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_session_type_allowed";
ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_session_type_allowed"
CHECK ("session_type" in ('standard', 'quick', 'breath', 'focus'));
