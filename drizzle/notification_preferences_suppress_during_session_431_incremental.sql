-- Suppress-during-session notification opt-in (issue #431).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "suppress_during_session" boolean DEFAULT false NOT NULL;
