-- Incremental DDL for notification preferences + dispatch ledger (issue #345).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).

-- Preview DBs may have a partial apply (table exists without expected columns).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'notification_preferences'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_preferences'
      AND column_name = 'push_enabled'
  ) THEN
    DROP TABLE IF EXISTS "notification_dispatches" CASCADE;
    DROP TABLE IF EXISTS "notification_preferences" CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"push_enabled" boolean DEFAULT false NOT NULL,
	"daily_reminder_enabled" boolean DEFAULT false NOT NULL,
	"miss_a_day_enabled" boolean DEFAULT false NOT NULL,
	"daily_reminder_time" varchar(5) DEFAULT '09:00' NOT NULL,
	"daily_reminder_frequency" varchar(20) DEFAULT 'daily' NOT NULL,
	"quiet_hours_start" varchar(5),
	"quiet_hours_end" varchar(5),
	"tz" varchar(64) DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_frequency_allowed" CHECK ("daily_reminder_frequency" in ('daily', 'every_other', 'weekly'))
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

CREATE INDEX IF NOT EXISTS "idx_notification_preferences_dispatch" ON "notification_preferences" USING btree ("push_enabled", "daily_reminder_enabled", "daily_reminder_time");

CREATE TABLE IF NOT EXISTS "notification_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_type" varchar(50) NOT NULL,
	"window_key" varchar(32) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
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

CREATE UNIQUE INDEX IF NOT EXISTS "notification_dispatches_user_type_window" ON "notification_dispatches" USING btree ("user_id", "notification_type", "window_key");
