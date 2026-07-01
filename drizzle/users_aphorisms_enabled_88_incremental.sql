-- Aphorisms pre-session inspiration toggle (issue #88). Off by default, same
-- boolean-preference pattern as users.is_public / users.email_deliverable.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aphorisms_enabled" boolean DEFAULT false NOT NULL;
