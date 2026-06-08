-- Web Push subscription storage (#347). One row per browser endpoint per user.

CREATE TABLE IF NOT EXISTS "web_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"endpoint_hash" varchar(64) NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" varchar(512),
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'web_push_subscriptions_user_id_users_id_fk'
      AND conrelid = 'public.web_push_subscriptions'::regclass
  ) THEN
    ALTER TABLE "web_push_subscriptions"
      ADD CONSTRAINT "web_push_subscriptions_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "web_push_subscriptions_endpoint_hash_unique"
  ON "web_push_subscriptions" USING btree ("endpoint_hash");

CREATE INDEX IF NOT EXISTS "idx_web_push_subscriptions_user_enabled"
  ON "web_push_subscriptions" USING btree ("user_id", "enabled");
