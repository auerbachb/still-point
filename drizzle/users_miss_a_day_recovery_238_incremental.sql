-- Miss-a-day recovery state (issue #238). Nullable trio tracks the ramp back to the
-- user's prior duration level after a 2+ day gap since their last completed standard
-- sit. All three columns are set together (`/api/auth/me` detection) and cleared
-- together (final recovery step completes in `/api/sessions`) — never partially set.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "recovery_target_day" integer,
  ADD COLUMN IF NOT EXISTS "recovery_current_step" integer,
  ADD COLUMN IF NOT EXISTS "recovery_total_steps" integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_recovery_all_or_none'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_recovery_all_or_none" CHECK (
        ("recovery_target_day" IS NULL) = ("recovery_current_step" IS NULL)
        AND ("recovery_current_step" IS NULL) = ("recovery_total_steps" IS NULL)
      );
  END IF;
END $$;
