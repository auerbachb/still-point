-- #146: Partial btree indexes for pending friend request inbox/outbox.
-- Idempotent; safe to re-apply. Does not alter friend_requests_pending_user_pair uniqueness.

CREATE INDEX IF NOT EXISTS "idx_friend_requests_to_pending_created" ON "friend_requests" USING btree ("to_user_id", "created_at" DESC) WHERE "status" = 'pending';
CREATE INDEX IF NOT EXISTS "idx_friend_requests_from_pending_created" ON "friend_requests" USING btree ("from_user_id", "created_at" DESC) WHERE "status" = 'pending';
