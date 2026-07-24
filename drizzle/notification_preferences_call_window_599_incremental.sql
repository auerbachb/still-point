-- Missed-sit outbound call opt-in + window (#599 / #638). Off by default; phone,
-- consent timestamp, and local call window stored on notification_preferences.

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "call_opt_in" boolean DEFAULT false NOT NULL;

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "call_phone_number" varchar(20);

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "call_consent_at" timestamp with time zone;

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "call_window_start" varchar(5);

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "call_window_stop" varchar(5);
