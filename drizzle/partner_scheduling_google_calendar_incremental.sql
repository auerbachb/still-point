-- Partner scheduling + Google Calendar sync (#204).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is a reference for existing databases if you apply SQL manually.

ALTER TABLE "buddy_sessions"
  ADD COLUMN IF NOT EXISTS "scheduled_start_at" timestamptz;

CREATE TABLE IF NOT EXISTS "google_oauth_tokens" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "google_sub" varchar(255),
  "google_email" varchar(255),
  "access_token_encrypted" text NOT NULL,
  "refresh_token_encrypted" text,
  "scope" text NOT NULL,
  "token_type" varchar(32) NOT NULL DEFAULT 'Bearer',
  "expiry_date" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_google_oauth_tokens_email"
  ON "google_oauth_tokens"("google_email");

CREATE TABLE IF NOT EXISTS "buddy_session_calendar_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "buddy_session_id" uuid NOT NULL REFERENCES "buddy_sessions"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "google_event_id" text,
  "html_link" text,
  "status" varchar(20) NOT NULL DEFAULT 'created',
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "buddy_session_calendar_events_session_user"
    UNIQUE ("buddy_session_id", "user_id"),
  CONSTRAINT "buddy_session_calendar_events_status_allowed"
    CHECK ("status" IN ('created', 'failed', 'deleted'))
);

CREATE INDEX IF NOT EXISTS "idx_buddy_session_calendar_events_session"
  ON "buddy_session_calendar_events"("buddy_session_id");

CREATE INDEX IF NOT EXISTS "idx_buddy_session_calendar_events_user"
  ON "buddy_session_calendar_events"("user_id");
