-- Incremental DDL for iOS push notification device tokens (issue #203).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is a reference for existing databases if you apply SQL manually.

CREATE TABLE IF NOT EXISTS "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(20) NOT NULL,
	"token" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"apns_environment" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_platform_allowed" CHECK ("platform" in ('ios')),
	CONSTRAINT "device_tokens_apns_environment_allowed" CHECK ("apns_environment" in ('development', 'production'))
);

ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "idx_device_tokens_user_enabled" ON "device_tokens" USING btree ("user_id", "enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "device_tokens_token_hash_env_unique" ON "device_tokens" USING btree ("token_hash", "apns_environment");
