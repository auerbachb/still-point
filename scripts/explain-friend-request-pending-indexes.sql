-- Issue #146: verify partial indexes with EXPLAIN (ANALYZE, BUFFERS).
-- 1. Replace the two UUID literals below with a user id that has several pending rows (or any user).
-- 2. Run twice: once before applying drizzle/friend_requests_pending_indexes_incremental.sql, once after.
--    psql "$POSTGRES_URL" -f scripts/explain-friend-request-pending-indexes.sql
--
-- Expect after migration: Bitmap Index Scan or Index Scan on
-- idx_friend_requests_to_pending_created / idx_friend_requests_from_pending_created
-- for the friend_requests leg (no large Seq Scan on friend_requests).

PREPARE friend_requests_incoming_pending AS
SELECT fr.id, fr.created_at, u.id, u.username
FROM friend_requests fr
INNER JOIN users u ON u.id = fr.from_user_id
WHERE fr.to_user_id = $1 AND fr.status = 'pending';

PREPARE friend_requests_outgoing_pending AS
SELECT fr.id, fr.created_at, u.id, u.username
FROM friend_requests fr
INNER JOIN users u ON u.id = fr.to_user_id
WHERE fr.from_user_id = $1 AND fr.status = 'pending';

-- >>> Replace with a real user UUID from your database <<<
EXPLAIN (ANALYZE, BUFFERS) EXECUTE friend_requests_incoming_pending('00000000-0000-0000-0000-000000000000'::uuid);
EXPLAIN (ANALYZE, BUFFERS) EXECUTE friend_requests_outgoing_pending('00000000-0000-0000-0000-000000000000'::uuid);

DEALLOCATE friend_requests_incoming_pending;
DEALLOCATE friend_requests_outgoing_pending;
