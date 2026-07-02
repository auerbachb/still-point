-- Dual-track fork (issue #240). Once the primary track passes the 10-minute mark
-- (currentDay > FORK_DAY) the user can opt into a second daily track that restarts
-- at 1 minute and ramps +10s/day. `dual_track_enabled` gates the second track;
-- `second_track_day` is its independent day counter. Both ship with
-- backward-compatible defaults so existing rows stay single-track.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "dual_track_enabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "second_track_day" integer NOT NULL DEFAULT 1;
