-- ============================================================================
-- Read-only DB audit: social + buddy tables (#143)
-- ============================================================================
-- SAFETY: Every statement below is a catalog/statistics SELECT. No DDL, no
-- DML, and no reads of user row data (privacy: only pg_catalog /
-- information_schema / pg_stat views are touched). Safe to run against
-- production at any time.
--
-- HOW TO RUN
--   psql:                 psql "$POSTGRES_URL" -f docs/db-audit-social-buddy.sql
--   single-statement      run each statement individually, in order; every
--   runners (e.g. Neon    statement is self-contained (the in-scope table
--   MCP run_sql):         list is repeated inline rather than parameterized).
--
-- SCOPE (from src/db/schema.ts)
--   social:   friend_requests, friendships
--   buddy:    buddy_sessions, buddy_session_participants,
--             buddy_session_calendar_events
--   adjacent: sessions (FK buddy_session_id), users (FK target for all)
--
-- INTERPRETATION NOTES
--   * pg_stat_* counters are cumulative since the stats reset reported in
--     Section 0 (NULL = never reset, i.e. since branch creation).
--   * Do NOT use EXPLAIN as index evidence on these tables: they are small
--     enough that the planner prefers seq scans regardless of index
--     presence. Index need is judged from catalog state + app query
--     patterns, not planner choices.
--   * idx_scan = 0 means "not used since stats reset", which on a young or
--     low-traffic deployment is weak evidence on its own. Combine with the
--     structural checks in Sections 7-8 before acting.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Section 0: Context — database + stats epoch
-- ----------------------------------------------------------------------------
SELECT current_database() AS database, stats_reset
FROM pg_stat_database WHERE datname = current_database();

-- ----------------------------------------------------------------------------
-- Section 1: Table sizes + tuple estimates
-- ----------------------------------------------------------------------------
SELECT c.relname AS table_name,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_relation_size(c.oid) AS heap_bytes,
       pg_indexes_size(c.oid) AS index_bytes,
       s.n_live_tup, s.n_dead_tup
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN ('friend_requests','friendships','buddy_sessions','buddy_session_participants','buddy_session_calendar_events','sessions','users')
ORDER BY c.relname;

-- ----------------------------------------------------------------------------
-- Section 2: Index definitions
-- ----------------------------------------------------------------------------
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('friend_requests','friendships','buddy_sessions','buddy_session_participants','buddy_session_calendar_events','sessions','users')
ORDER BY tablename, indexname;

-- ----------------------------------------------------------------------------
-- Section 3: Index flags — uniqueness, primary, validity, partial predicate
-- (indisvalid = false would indicate a broken/aborted concurrent build)
-- ----------------------------------------------------------------------------
SELECT t.relname AS table_name, i.relname AS index_name,
       x.indisunique, x.indisprimary, x.indisvalid,
       pg_get_expr(x.indpred, x.indrelid) AS partial_predicate
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN ('friend_requests','friendships','buddy_sessions','buddy_session_participants','buddy_session_calendar_events','sessions','users')
ORDER BY t.relname, i.relname;

-- ----------------------------------------------------------------------------
-- Section 4: Constraint inventory — PK (p), FK (f), UNIQUE (u), CHECK (c)
-- (convalidated = false would indicate a NOT VALID constraint awaiting
-- VALIDATE CONSTRAINT)
-- ----------------------------------------------------------------------------
SELECT t.relname AS table_name, con.conname, con.contype, con.convalidated,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class t ON t.oid = con.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN ('friend_requests','friendships','buddy_sessions','buddy_session_participants','buddy_session_calendar_events','sessions','users')
ORDER BY t.relname, con.contype, con.conname;

-- ----------------------------------------------------------------------------
-- Section 5: Index usage statistics
-- ----------------------------------------------------------------------------
SELECT s.relname AS table_name, s.indexrelname AS index_name,
       s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
       pg_relation_size(s.indexrelid) AS index_bytes
FROM pg_stat_user_indexes s
WHERE s.schemaname = 'public'
  AND s.relname IN ('friend_requests','friendships','buddy_sessions','buddy_session_participants','buddy_session_calendar_events','sessions','users')
ORDER BY s.relname, s.idx_scan DESC;

-- ----------------------------------------------------------------------------
-- Section 6: Table scan + write patterns
-- ----------------------------------------------------------------------------
SELECT relname AS table_name, seq_scan, seq_tup_read, idx_scan, idx_tup_fetch,
       n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN ('friend_requests','friendships','buddy_sessions','buddy_session_participants','buddy_session_calendar_events','sessions','users')
ORDER BY relname;

-- ----------------------------------------------------------------------------
-- Section 7: FK leading-column index coverage (single-column FKs)
-- An FK whose referencing column is not the LEADING column of some valid,
-- non-partial index forces a table scan on every parent-row DELETE/UPDATE
-- (cascade or SET NULL). Partial indexes are excluded: they cannot serve
-- cascade probes for rows outside their predicate.
-- NOTE: pg_index.indkey is an int2vector (0-based subscripts);
-- pg_constraint.conkey is int2[] (1-based) — hence indkey[0] vs conkey[1].
-- ----------------------------------------------------------------------------
SELECT t.relname AS table_name, con.conname,
       a.attname AS fk_column,
       EXISTS (
         SELECT 1 FROM pg_index x
         WHERE x.indrelid = con.conrelid
           AND x.indisvalid
           AND x.indpred IS NULL
           AND x.indkey[0] = con.conkey[1]
       ) AS fk_leading_col_indexed
FROM pg_constraint con
JOIN pg_class t ON t.oid = con.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
WHERE con.contype = 'f'
  AND n.nspname = 'public'
  AND t.relname IN ('friend_requests','friendships','buddy_sessions','buddy_session_participants','buddy_session_calendar_events','sessions','users')
  AND array_length(con.conkey, 1) = 1
ORDER BY t.relname, con.conname;

-- ----------------------------------------------------------------------------
-- Section 8: Redundant prefix-duplicate index detection
-- Flags a plain (non-unique, non-primary, non-partial, non-expression) index
-- whose key columns are an exact positional prefix of another non-partial,
-- non-expression index on the same table. Such an index adds write cost with
-- no read benefit. Caveats: (a) two identical plain duplicates flag each
-- other (two rows); (b) this is an equality/prefix heuristic — confirm
-- against app query patterns before dropping anything.
-- ----------------------------------------------------------------------------
SELECT t.relname AS table_name,
       i2.relname AS redundant_index,
       i1.relname AS covering_index,
       pg_get_indexdef(x2.indexrelid) AS redundant_def,
       pg_get_indexdef(x1.indexrelid) AS covering_def
FROM pg_index x1
JOIN pg_index x2 ON x1.indrelid = x2.indrelid AND x1.indexrelid <> x2.indexrelid
JOIN pg_class i1 ON i1.oid = x1.indexrelid
JOIN pg_class i2 ON i2.oid = x2.indexrelid
JOIN pg_class t ON t.oid = x1.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN ('friend_requests','friendships','buddy_sessions','buddy_session_participants','buddy_session_calendar_events','sessions','users')
  AND x1.indpred IS NULL AND x2.indpred IS NULL
  AND x1.indexprs IS NULL AND x2.indexprs IS NULL
  AND NOT x2.indisunique
  AND NOT x2.indisprimary
  AND x2.indnkeyatts <= x1.indnkeyatts
  AND (SELECT bool_and(x1.indkey[g.i] = x2.indkey[g.i])
       FROM generate_series(0, x2.indnkeyatts - 1) AS g(i))
ORDER BY t.relname, i2.relname;

-- ----------------------------------------------------------------------------
-- Section 9: Column inventory (drift check vs src/db/schema.ts)
-- information_schema is read-only views over pg_catalog.
-- ----------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('friend_requests','friendships','buddy_sessions','buddy_session_participants','buddy_session_calendar_events','sessions','users')
ORDER BY table_name, ordinal_position;
