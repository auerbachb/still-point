-- Incremental DDL for password reset tokens (issue #160).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is a reference for existing databases if you apply SQL manually.

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"request_ip_hash" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'password_reset_tokens_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "password_reset_tokens"
      ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_unique"
ON "password_reset_tokens" USING btree ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_password_reset_tokens_user"
ON "password_reset_tokens" USING btree ("user_id");
DROP INDEX IF EXISTS "idx_password_reset_tokens_active_user";
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_active_user_unique"
ON "password_reset_tokens" USING btree ("user_id")
WHERE "used_at" IS NULL;
