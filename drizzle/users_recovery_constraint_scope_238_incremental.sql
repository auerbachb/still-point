-- Scope the users_recovery_all_or_none constraint guard to the `users` table.
-- The original migration (users_miss_a_day_recovery_238_incremental.sql) checked
-- pg_constraint by conname only, which is not unique across all tables; a same-named
-- constraint on a different table would cause the guard to skip adding the check on
-- `users`. This migration is a no-op if the constraint already exists on `users`
-- (the common path), and adds it with the correct guard if it was somehow missing.
DO $$
BEGIN
  -- Drop the constraint if it exists on the wrong table (safety: should not occur).
  -- Then re-add scoped to `users` if not already present.
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
