-- Per-session track attribution (issue #240). Records whether a sit advanced the
-- primary (original, 10-minute-capped) track or the opt-in second track. Defaults
-- to 'primary' so every pre-#240 row is attributed to the original track.
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "track" varchar(16) NOT NULL DEFAULT 'primary';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_track_allowed'
      AND conrelid = 'sessions'::regclass
  ) THEN
    ALTER TABLE "sessions"
      ADD CONSTRAINT "sessions_track_allowed" CHECK ("track" IN ('primary', 'second'));
  END IF;
END $$;

-- Backs the per-track "completed this track's standard sit today?" lookup that
-- drives HomeView's dual-track completion badges.
CREATE INDEX IF NOT EXISTS "idx_sessions_user_track_date"
  ON "sessions" ("user_id", "track", "session_date");
