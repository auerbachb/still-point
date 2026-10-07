-- Session-scoped notification holds (issue #741).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- The existing notification_preferences.session_active_until column stays.
-- Keyed writes recompute it; clients that omit sessionKey still write it directly.

CREATE TABLE IF NOT EXISTS "session_notification_holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "session_key" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'session_notification_holds_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "session_notification_holds"
      ADD CONSTRAINT "session_notification_holds_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "session_notification_holds_user_session_key_unique"
ON "session_notification_holds" USING btree ("user_id", "session_key");

CREATE INDEX IF NOT EXISTS "idx_session_notification_holds_user_expires"
ON "session_notification_holds" USING btree ("user_id", "expires_at");
