-- #837 (focus activity tracking 3/5, #765): what a focus session was for, one of
-- 'reading', 'writing' or 'listening'. A label only: every category shares the
-- one focus goal (users.focus_activity_day). Nullable, so every existing row,
-- and every session that is not a focus session, reads as no category.
-- Depends only on "sessions", so its place in the runner's order does not matter.
-- Idempotent + safe to re-run. Do NOT edit after it is applied (the
-- schema_migrations checksum ledger will reject a changed body).

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "focus_category" varchar(32);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sessions_focus_category_allowed'
      AND conrelid = 'sessions'::regclass
  ) THEN
    ALTER TABLE "sessions"
      ADD CONSTRAINT "sessions_focus_category_allowed"
      CHECK ("focus_category" IS NULL OR "focus_category" IN ('reading', 'writing', 'listening'));
  END IF;
END $$;
