-- Friend request notification opt-in (issue #359).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "friend_request_notifications_enabled" boolean DEFAULT true NOT NULL;
