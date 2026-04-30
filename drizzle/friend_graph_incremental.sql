-- Incremental DDL for friend graph (issue #116).
-- Preferred: apply schema with `npx drizzle-kit push` (see README).
-- This file is a reference for existing databases if you apply SQL manually.

CREATE TABLE IF NOT EXISTS "friend_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "friend_requests_no_self" CHECK ("from_user_id" <> "to_user_id"),
	CONSTRAINT "friend_requests_status_allowed" CHECK ("status" in ('pending', 'accepted', 'rejected', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS "friendships" (
	"user1_id" uuid NOT NULL,
	"user2_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_user1_id_user2_id_pk" PRIMARY KEY("user1_id","user2_id"),
	CONSTRAINT "friendships_user_order" CHECK ("user1_id" < "user2_id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friend_requests_from_user_id_users_id_fk') THEN
    ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friend_requests_to_user_id_users_id_fk') THEN
    ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendships_user1_id_users_id_fk') THEN
    ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user1_id_users_id_fk" FOREIGN KEY ("user1_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendships_user2_id_users_id_fk') THEN
    ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user2_id_users_id_fk" FOREIGN KEY ("user2_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- Replace legacy directional pending index with unordered pair (run once if upgrading from #116 initial schema).
DROP INDEX IF EXISTS "friend_requests_pending_from_to";
CREATE UNIQUE INDEX IF NOT EXISTS "friend_requests_pending_user_pair" ON "friend_requests" USING btree (
  LEAST("from_user_id", "to_user_id"),
  GREATEST("from_user_id", "to_user_id")
) WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "idx_friend_requests_from" ON "friend_requests" USING btree ("from_user_id");
CREATE INDEX IF NOT EXISTS "idx_friend_requests_to" ON "friend_requests" USING btree ("to_user_id");
CREATE INDEX IF NOT EXISTS "idx_friendships_user1" ON "friendships" USING btree ("user1_id");
CREATE INDEX IF NOT EXISTS "idx_friendships_user2" ON "friendships" USING btree ("user2_id");
