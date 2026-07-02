-- iOS ARKit gaze attention tracking opt-in (issue #113). Off by default, same
-- boolean-preference pattern as users.aphorisms_enabled.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "attention_tracking_enabled" boolean DEFAULT false NOT NULL;
