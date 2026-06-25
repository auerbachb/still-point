-- #384 follow-up: re-drop idx_buddy_session_calendar_events_session after
-- partner_scheduling_google_calendar_incremental.sql, which recreates it with
-- CREATE INDEX IF NOT EXISTS. On existing databases this file is a no-op (the
-- index was already dropped by buddy_session_calendar_events_drop_session_index_incremental.sql).
-- On greenfield/backfill runs the lexicographic sort causes the first drop to run
-- before the partner-scheduling migration recreates the index; this late-sorting
-- file ensures the net result is the same: index absent. Idempotent; safe to re-apply.
DROP INDEX IF EXISTS "idx_buddy_session_calendar_events_session";
