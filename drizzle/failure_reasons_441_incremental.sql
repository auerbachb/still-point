-- Meditation failure-reason log (#441). One row per user per local calendar day,
-- revisable via upsert on the (user_id, reason_date) unique index.

CREATE TABLE IF NOT EXISTS "failure_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason_date" date NOT NULL,
	"text" varchar(1000) NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'failure_reasons_user_id_users_id_fk'
      AND conrelid = 'public.failure_reasons'::regclass
  ) THEN
    ALTER TABLE "failure_reasons"
      ADD CONSTRAINT "failure_reasons_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "failure_reasons_user_date_unique"
  ON "failure_reasons" USING btree ("user_id", "reason_date");
