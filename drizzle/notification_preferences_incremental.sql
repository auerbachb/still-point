-- Notification preferences + scheduler cursors (#345, #346, #247 de-dup).
-- Preferred: apply via `npm run db:migrate` (see README).

CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"daily_reminder_enabled" boolean DEFAULT true NOT NULL,
	"preferred_time" varchar(5) DEFAULT '09:00' NOT NULL,
	"frequency" varchar(20) DEFAULT 'daily' NOT NULL,
	"quiet_hours_start" varchar(5),
	"quiet_hours_end" varchar(5),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"last_daily_reminder_sent_at" timestamp with time zone,
	"last_miss_a_day_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_frequency_allowed" CHECK ("frequency" in ('daily', 'every_other_day', 'weekly'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_preferences_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "notification_preferences"
      ADD CONSTRAINT "notification_preferences_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "public"."users"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_user_unique" ON "notification_preferences" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_notification_preferences_scheduler" ON "notification_preferences" USING btree ("enabled", "daily_reminder_enabled", "timezone");
