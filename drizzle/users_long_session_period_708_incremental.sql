-- #708: which time of day the long (primary) session is designated.
-- The short (second) track is the opposite period. A label only — completing
-- a track checks that track even when the sit happens at the other time of day.
-- Default 'am' so existing dual-track rows keep the long session as morning.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "long_session_period" varchar(2) NOT NULL DEFAULT 'am';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_long_session_period_allowed'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_long_session_period_allowed"
      CHECK ("long_session_period" IN ('am', 'pm'));
  END IF;
END $$;
