-- #109: post-session self-report ratings (focus + happiness), 1-10, nullable
-- until set via the sessions by-session PATCH route from the CompletionScreen
-- sliders.
-- Idempotent + safe to re-run on hand-migrated databases (matches the runner
-- contract in scripts/apply-migrations.ts). Do NOT edit after it is applied
-- (the schema_migrations checksum ledger will reject a changed body).

ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "focus_rating" integer;

ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "happiness_rating" integer;

ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_focus_rating_range";
ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_focus_rating_range"
CHECK ("focus_rating" is null or ("focus_rating" between 1 and 10));

ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_happiness_rating_range";
ALTER TABLE "sessions"
ADD CONSTRAINT "sessions_happiness_rating_range"
CHECK ("happiness_rating" is null or ("happiness_rating" between 1 and 10));
