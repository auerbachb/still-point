-- Failure-reason reminder opt-in (issue #441). Fixed 8 PM local "log why you
-- couldn't meditate" notification; defaults off like the other reminder flags.

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "failure_reason_reminder_enabled" boolean DEFAULT false NOT NULL;
