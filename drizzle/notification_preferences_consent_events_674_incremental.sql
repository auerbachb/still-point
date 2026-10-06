-- Append-only call/SMS consent log (#674). Opt-out inserts a revoked row.
-- Existing non-null call_consent_at values are backfilled as granted events.
-- phone_number is left null: the current call_phone_number may not be the
-- number that was consented at call_consent_at. Opt-outs that already nulled
-- call_consent_at cannot be reconstructed.

CREATE TABLE IF NOT EXISTS "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" varchar(16) NOT NULL,
	"phone_number" varchar(20),
	"event" varchar(16) NOT NULL,
	"disclosure_version" varchar(64),
	"method" varchar(64),
	"ip" varchar(64),
	"created_at" timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consent_events_user_id_users_id_fk'
      AND conrelid = 'public.consent_events'::regclass
  ) THEN
    ALTER TABLE "consent_events"
      ADD CONSTRAINT "consent_events_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consent_events_channel_allowed'
      AND conrelid = 'public.consent_events'::regclass
  ) THEN
    ALTER TABLE "consent_events"
      ADD CONSTRAINT "consent_events_channel_allowed"
      CHECK ("channel" IN ('call', 'sms'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'consent_events_event_allowed'
      AND conrelid = 'public.consent_events'::regclass
  ) THEN
    ALTER TABLE "consent_events"
      ADD CONSTRAINT "consent_events_event_allowed"
      CHECK ("event" IN ('granted', 'revoked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "consent_events_user_created_idx"
  ON "consent_events" USING btree ("user_id", "created_at");

INSERT INTO "consent_events" (
  "user_id",
  "channel",
  "event",
  "created_at"
)
SELECT
  np."user_id",
  'call',
  'granted',
  np."call_consent_at"
FROM "notification_preferences" np
WHERE np."call_consent_at" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "consent_events" ce
    WHERE ce."user_id" = np."user_id"
      AND ce."channel" = 'call'
      AND ce."event" = 'granted'
      AND ce."created_at" = np."call_consent_at"
  );
