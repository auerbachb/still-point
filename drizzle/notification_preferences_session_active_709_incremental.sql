-- Server-side session-active signal + suppress-during-session default flip (issue #709).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "session_active_until" timestamptz;

-- Silencing Still Point's own notifications during a sit is now the default
-- promise rather than an opt-in (#431 shipped it as opt-in, default false).
ALTER TABLE "notification_preferences"
  ALTER COLUMN "suppress_during_session" SET DEFAULT true;

-- Backfill existing rows so users are covered without visiting Settings.
--
-- This resets a deliberate opt-out too, and that is accepted rather than
-- overlooked: under the old `false` default, "never opened Notification
-- settings" and "turned the toggle off on purpose" both store exactly `false`,
-- so no narrower backfill can tell them apart. Skipping the backfill instead
-- would leave every existing user — including the one who reported #709 — still
-- getting banners mid-sit, which is the bug this migration exists to fix.
-- The "During sessions" toggle stays on both Settings screens, so anyone who
-- did mean to opt out can turn it back off after this runs.
UPDATE "notification_preferences"
  SET "suppress_during_session" = true
  WHERE "suppress_during_session" = false;
