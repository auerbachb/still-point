ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "session_type" varchar(20) DEFAULT 'standard' NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_session_type_allowed'
  ) THEN
    ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_session_type_allowed"
    CHECK ("session_type" in ('standard', 'quick'));
  END IF;
END $$;
