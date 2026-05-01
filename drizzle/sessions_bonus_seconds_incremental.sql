ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "bonus_seconds" integer DEFAULT 0 NOT NULL;
