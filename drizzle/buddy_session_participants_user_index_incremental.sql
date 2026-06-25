-- #383: idx_buddy_session_participants_user (user_id).
-- Backs `WHERE user_id = ?` calendar lookups (src/lib/buddyCalendar.ts) and the
-- ON DELETE CASCADE fan-out from users on account deletion. The unique
-- (buddy_session_id, user_id) index can't serve a standalone user_id predicate
-- because user_id is not its leading column.
-- Idempotent; safe to re-apply. Applied via npm run db:migrate on deploy.
CREATE INDEX IF NOT EXISTS "idx_buddy_session_participants_user"
  ON "buddy_session_participants" ("user_id");
