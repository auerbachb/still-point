-- Incremental DDL for per-user buddy session history (#119).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is a reference for existing databases if you apply SQL manually.

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "buddy_session_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_buddy_session_id_buddy_sessions_id_fk'
  ) THEN
    ALTER TABLE "sessions" ADD CONSTRAINT "sessions_buddy_session_id_buddy_sessions_id_fk"
      FOREIGN KEY ("buddy_session_id") REFERENCES "public"."buddy_sessions"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_sessions_buddy_session" ON "sessions" USING btree ("buddy_session_id");

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_user_buddy_session_unique" ON "sessions" USING btree ("user_id", "buddy_session_id")
  WHERE ("buddy_session_id" IS NOT NULL);
