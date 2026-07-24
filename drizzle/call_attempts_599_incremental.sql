-- Outbound missed-sit call attempt log (#599 / #639). One row per scheduler-initiated call.

CREATE TABLE IF NOT EXISTS "call_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"vapi_call_id" varchar(64),
	"phone_number" varchar(20) NOT NULL,
	"window_key" varchar(32) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_message" varchar(500),
	"created_at" timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'call_attempts_user_id_users_id_fk'
      AND conrelid = 'public.call_attempts'::regclass
  ) THEN
    ALTER TABLE "call_attempts"
      ADD CONSTRAINT "call_attempts_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "call_attempts_user_window_idx"
  ON "call_attempts" USING btree ("user_id", "window_key");
