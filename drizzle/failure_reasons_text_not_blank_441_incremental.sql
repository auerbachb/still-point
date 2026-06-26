-- #441 review: enforce the non-empty note invariant at the DB layer so a blank or
-- whitespace-only row can't suppress the reminder via hasFailureReasonForDate().
-- Added as a NEW incremental file because failure_reasons_441_incremental.sql is
-- already applied to the shared preview branch (append-only migrations; #368/#370).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'failure_reasons_text_not_blank'
      AND conrelid = 'public.failure_reasons'::regclass
  ) THEN
    ALTER TABLE "failure_reasons"
      ADD CONSTRAINT "failure_reasons_text_not_blank"
      CHECK (char_length(btrim("text")) > 0);
  END IF;
END $$;
