CREATE TABLE IF NOT EXISTS "account_deletion_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "email_hash" varchar(64) NOT NULL,
  "deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_account_deletion_log_email_hash"
  ON "account_deletion_log" ("email_hash");

CREATE INDEX IF NOT EXISTS "idx_account_deletion_log_user"
  ON "account_deletion_log" ("user_id");
