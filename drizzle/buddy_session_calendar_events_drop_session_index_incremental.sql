-- #384: drop redundant idx_buddy_session_calendar_events_session (buddy_session_id).
-- It is an exact leading prefix of the unique (buddy_session_id, user_id) index
-- (buddy_session_calendar_events_session_user), so that btree already serves any
-- standalone buddy_session_id predicate. KEEP idx_buddy_session_calendar_events_user.
-- Precedent: friendships_drop_user1_index_incremental.sql.
-- Idempotent; safe to re-apply. Applied via npm run db:migrate on deploy.
DROP INDEX IF EXISTS "idx_buddy_session_calendar_events_session";
