-- #354: neutral DB default + scoped FK guard for fresh installs.
-- Do not edit notification_preferences_incremental.sql (checksum-locked on preview/prod).

ALTER TABLE "notification_preferences"
  ALTER COLUMN "timezone" SET DEFAULT 'UTC';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notification_preferences_user_id_users_id_fk'
      AND conrelid = 'public.notification_preferences'::regclass
  ) THEN
    ALTER TABLE "notification_preferences"
      ADD CONSTRAINT "notification_preferences_user_id_users_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "public"."users"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;
