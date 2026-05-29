-- Notification preferences + dispatch log (#345 foundation, #247 miss-a-day, #346 daily reminder).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is a reference for existing databases if you apply SQL manually.

CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"reminder_time" varchar(5) DEFAULT '09:00' NOT NULL,
	"frequency" varchar(20) DEFAULT 'daily' NOT NULL,
	"quiet_hours_start" varchar(5),
	"quiet_hours_end" varchar(5),
	"daily_reminder_enabled" boolean DEFAULT true NOT NULL,
	"miss_a_day_enabled" boolean DEFAULT true NOT NULL,
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

CREATE TABLE IF NOT EXISTS "notification_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"notification_type" varchar(32) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_dispatches_type_allowed" CHECK ("notification_type" in ('daily_reminder', 'miss_a_day'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_dispatches_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "notification_dispatches"
      ADD CONSTRAINT "notification_dispatches_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "public"."users"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_dispatches_user_local_date_unique"
  ON "notification_dispatches" USING btree ("user_id", "local_date");
CREATE INDEX IF NOT EXISTS "idx_notification_dispatches_user"
  ON "notification_dispatches" USING btree ("user_id");
