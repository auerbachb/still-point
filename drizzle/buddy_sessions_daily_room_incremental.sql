-- Daily.co room fields for buddy video (#106).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is a reference for existing databases if you apply SQL manually.

ALTER TABLE "buddy_sessions" ADD COLUMN IF NOT EXISTS "daily_room_name" varchar(128);
ALTER TABLE "buddy_sessions" ADD COLUMN IF NOT EXISTS "daily_room_url" text;
