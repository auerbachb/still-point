-- Server-side session-active signal + suppress-during-session default flip (issue #709).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "session_active_until" timestamptz;

-- Silencing Still Point's own notifications during a sit is now the default
-- promise rather than an opt-in (#431 shipped it as opt-in, default false).
ALTER TABLE "notification_preferences"
  ALTER COLUMN "suppress_during_session" SET DEFAULT true;

-- Backfill existing rows so users are covered without visiting Settings. The
-- previous default was false, so a stored false is almost always "never opted
-- in" rather than a deliberate opt-out; the "During sessions" toggle still lets
-- anyone turn it back off after this runs.
UPDATE "notification_preferences"
  SET "suppress_during_session" = true
  WHERE "suppress_during_session" = false;
