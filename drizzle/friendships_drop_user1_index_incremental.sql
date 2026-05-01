-- Issue #148: idx_friendships_user1 is redundant with PK (user1_id, user2_id).
-- B-tree PK is usable for predicates on user1_id alone (left-prefix); app queries
-- use user1_id = ? with or without user2_id = ? — both match the PK.
-- Capture pg_stat_user_indexes (idx_scan, idx_tup_fetch) over a window before prod;
-- expect idx_friendships_user1 ~0 scans if redundant. Apply via npm run db:migrate only.
DROP INDEX IF EXISTS "idx_friendships_user1";
