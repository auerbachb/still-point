# Prod DB hygiene report: social + buddy tables (#143)

| | |
|---|---|
| **Audited** | 2026-06-11 |
| **Environment** | Neon project `noisy-cell-87641627`, branch `production` (`br-rough-salad-aixcbca7`, the project default), database `neondb` |
| **Method** | Catalog-only read-only SQL — [`docs/db-audit-social-buddy.sql`](./db-audit-social-buddy.sql), run statement-by-statement. **Zero DDL/DML applied; no user row data read** (only `pg_catalog` / `information_schema` / `pg_stat` views). |
| **Stats epoch** | `pg_stat_database.stats_reset` is `NULL` → counters are cumulative since branch creation (2026-02-26). |
| **Outcome** | 2 migration candidates → filed as #383 and #384. #147 (already filed) confirmed still needed. No schema drift between prod and `src/db/schema.ts`. |

> **EXPLAIN was deliberately not used as index evidence.** Every table in scope is small enough that the planner seq-scans regardless of index presence, so planner output proves nothing here. Index conclusions below come from catalog state (what exists) + app query patterns (what the code asks for) + FK mechanics (what cascades need).

## 1. Tables in scope (from `src/db/schema.ts`)

| Table | Category | Why in scope |
|---|---|---|
| `friend_requests` | social | friend request inbox/outbox + status lifecycle |
| `friendships` | social | accepted-friend pairs, ordered `(user1_id < user2_id)` |
| `buddy_sessions` | buddy | shared sit lifecycle (`waiting → ready_check → active → completed/abandoned`) |
| `buddy_session_participants` | buddy (membership) | per-user membership/heartbeat rows |
| `buddy_session_calendar_events` | buddy (membership) | per-user Google Calendar sync state (#204) |
| `sessions` | adjacent | personal sits; `buddy_session_id` FK provenance (#119) |
| `users` | adjacent | FK target of every table above (host / from / to / member) |

Out of scope: auth/notification tables (`oauth_accounts`, `device_tokens`, `notification_*`, `web_push_subscriptions`, `password_reset_tokens`, `google_oauth_tokens`, `thoughts`, `account_deletion_log`).

## 2. Size snapshot (Section 1 of the script)

| Table | live tuples | dead tuples | total bytes |
|---|---:|---:|---:|
| `buddy_session_calendar_events` | 0 | 0 | 40,960 |
| `buddy_session_participants` | 14 | 7 | 73,728 |
| `buddy_sessions` | 8 | 10 | 65,536 |
| `friend_requests` | 4 | 5 | 106,496 |
| `friendships` | 4 | 0 | 40,960 |
| `sessions` | 114 | 0 | 122,880 |
| `users` | 28 | 32 | 81,920 |

Everything is tiny (≤120 KB). Findings below are **structural hygiene** — they matter for correctness-of-scale and cascade behavior, not for present-day latency.

## 3. Catalog state vs `schema.ts` — drift check

**No drift found.** All 25 indexes present in prod match `schema.ts` declarations one-for-one (names, columns, uniqueness, partial predicates); every index is `indisvalid = true`; all 27 constraints (PK/FK/UNIQUE/CHECK) are `convalidated = true` with definitions matching the schema (Sections 2–4, 9 of the script). Column inventory (types, nullability, defaults) matches for all 7 tables, including the deliberate mixed timestamp style (`timestamptz` on buddy tables, `timestamp` on the older social/users/sessions tables) — that mix mirrors `schema.ts` itself, so it is a schema-design note, not prod drift.

One cosmetic asymmetry, not drift: `buddy_session_calendar_events_session_user` exists as a `UNIQUE` **constraint** (with its backing index) while the equivalent `buddy_session_participants_session_user` is a bare unique **index** — both declared via `uniqueIndex()` in `schema.ts`, both enforcing identical uniqueness. No action needed.

## 4. Per-table coverage assessment

Query patterns were mapped from the app code (API routes, `src/lib/buddySession.ts`, `src/lib/buddyCalendar.ts`, `src/lib/google.ts`, notification cron).

### 4.1 `friend_requests` — ✅ healthy
- Hot paths: inbox/outbox lists `WHERE to_user_id|from_user_id = ? AND status='pending'` ([route.ts:21,33](../src/app/api/friends/requests/route.ts)) → matched exactly by the #146 partial indexes `idx_friend_requests_{to,from}_pending_created (…, created_at DESC) WHERE status='pending'`.
- Duplicate-pair guard: unique partial `friend_requests_pending_user_pair (LEAST(from,to), GREATEST(from,to)) WHERE status='pending'` enforces one pending request per unordered pair — present and validated.
- The full (non-partial) `idx_friend_requests_from` / `idx_friend_requests_to` show `idx_scan = 0`, but they are **not** drop candidates: the partial pending indexes cannot serve the `users → friend_requests` `ON DELETE CASCADE` probes for non-pending rows, so the full indexes are the FK-support indexes (both flagged ✅ by the Section 7 coverage query).
- Integrity: `no_self` CHECK + status CHECK present. Terminal rows (accepted/rejected/cancelled) accumulate indefinitely, but the partial indexes keep hot paths immune to that growth — no action needed.

### 4.2 `friendships` — ✅ healthy
- PK `(user1_id, user2_id)` serves the pair lookups (request-send guard, buddy-join friendship gate, calendar `assertFriendship`) and the `user1_id` UNION half of `GET /api/friends`; `idx_friendships_user2` serves the `user2_id` half and the `user2_id` FK cascade. Both sides ✅ in Section 7.
- `friendships_user_order` CHECK (`user1_id < user2_id`) enforces canonical pair ordering. Stats confirm index use (`idx_scan` 59 + 11). The earlier redundant `idx_friendships_user1` was already dropped (#148).

### 4.3 `buddy_sessions` — ✅ healthy
- All hot operations are PK point lookups: the polling heartbeat (`GET /api/buddy/sessions/[id]` → reconcile + snapshot) and every state transition filter `WHERE id = ?` (often `AND state = …` as an optimistic guard — fine on top of a PK probe). `buddy_sessions_pkey` shows 2,162 scans, by far the hottest index in scope — correctly backed.
- `share_token` unique index backs the one-shot join lookup; `idx_buddy_sessions_host` backs the `host_user_id` FK cascade (✅ Section 7).
- State CHECK present. Calendar-view ordering (`COALESCE(started_at, scheduled_start_at, created_at)`) is applied to an already-narrowed id set from participant subqueries; no index need at any plausible scale.

### 4.4 `buddy_session_participants` — ⚠️ two findings
- Hot paths are covered: the per-heartbeat membership gate `WHERE buddy_session_id = ? AND user_id = ?` and the participant-list reads `WHERE buddy_session_id = ?` are both served by the unique `buddy_session_participants_session_user (buddy_session_id, user_id)` (left-prefix); the per-heartbeat `last_seen_at` update targets the row PK. (Stats show 9,530 seq scans — that is the planner preferring seq scans on a 14-row table, expected and not evidence of a gap; see the EXPLAIN note above.)
- **Finding A — no `user_id`-leading index** (the only ❌ row in the Section 7 FK-coverage query). `user_id` is the *second* column of the unique index, which cannot serve: (a) the calendar-view subqueries `WHERE user_id = <viewer>` / `<buddy>` run on every calendar page load ([buddyCalendar.ts:88,111](../src/lib/buddyCalendar.ts)), and (b) the `users → buddy_session_participants` `ON DELETE CASCADE` probe on account deletion. Every sibling membership table has this index; this is the one gap. → **filed as #383**.
- **Finding B — host-row uniqueness is app-enforced only.** Nothing in the catalog prevents two `is_host = true` rows (or zero) per session. → **already filed as #147** (partial unique index on `(buddy_session_id) WHERE is_host`); this audit confirms the constraint is absent in prod. Note for #147 implementation: this pass was catalog-only, so run a duplicate-host precheck (count of sessions with ≠1 host row) before adding the constraint, and dedupe if needed.

### 4.5 `buddy_session_calendar_events` — ⚠️ one finding
- The feature is freshly deployed: 0 rows, all-zero stats. The unique `(buddy_session_id, user_id)` backs both the idempotency check and the `onConflictDoUpdate` target in [google.ts:423,451](../src/lib/google.ts); `idx_buddy_session_calendar_events_user` backs the `user_id` FK cascade. Status CHECK + both FK cascades validated.
- **Finding C — `idx_buddy_session_calendar_events_session (buddy_session_id)` is an exact leading prefix** of the unique `(buddy_session_id, user_id)` index (both plain btree, non-partial) — the only row flagged by the Section 8 redundancy query. It adds write cost on every row touch and can never beat the composite for reads. Same cleanup as the #148 `friendships` precedent. → **filed as #384**.

### 4.6 `sessions` (buddy-adjacent paths) — ✅ healthy
- `(user_id, buddy_session_id)` idempotency check + recovery read are served by the partial unique `sessions_user_buddy_session_unique … WHERE buddy_session_id IS NOT NULL` (also the integrity guarantee: one personal row per user per shared sit). `idx_sessions_buddy_session` is the non-partial FK-support index for the `buddy_sessions → sessions` `ON DELETE SET NULL` (✅ Section 7) — not redundant with the partial unique (different leading column, and partials can't serve cascades).
- `idx_sessions_user (user_id, day_number)` backs the per-user list/day lookups and the cron streak reads (leading-column match; the `session_date` filter is applied on top — acceptable, see §5.3).

### 4.7 `users` (adjacent) — ✅ healthy
- PK (2,052 scans — auth on every request), `email` unique (login/signup), `lower(username)` unique (#8) all present and valid. `idx_users_public` backs the board's `is_public = true` filter; low selectivity but harmless at this scale.

## 5. Migration candidates

### Filed from this audit
| # | Change | Driver |
|---|---|---|
| **#383** | `CREATE INDEX idx_buddy_session_participants_user ON buddy_session_participants (user_id)` (new incremental migration + `schema.ts`) | Only failing row of the FK-coverage check; calendar-view subqueries filter `user_id` alone per page load; account-deletion cascade support. |
| **#384** | `DROP INDEX idx_buddy_session_calendar_events_session` (new incremental migration + `schema.ts`) | Exact redundant prefix of the unique `(buddy_session_id, user_id)` index; pure write overhead. Keep the `user_id` index (FK support). |

### Pre-existing, confirmed by this audit
| # | Change | Audit confirmation |
|---|---|---|
| **#147** | Partial unique index enforcing one `is_host = true` row per `buddy_session_id` | No such constraint exists in prod; host integrity is currently application-convention only. Referenced, not re-filed. |

### Considered and rejected (explicitly *not* filing)
- **Drop `idx_friend_requests_from` / `idx_friend_requests_to`** (0 scans): rejected — they are the FK cascade-support indexes; the pending partial indexes can't cover non-pending rows.
- **Make `idx_sessions_buddy_session` partial (`WHERE buddy_session_id IS NOT NULL`)**: technically sound (cascade probes only ever target non-NULL values; most rows are solo sits with NULL) but the saving is a few KB and it adds an applied-migration churn risk for nothing at current scale. Revisit only if `sessions` reaches millions of rows.
- **Partial/drop `idx_users_public`**: low-selectivity boolean index, but it serves the board query and costs ~16 KB. Not worth a migration.
- **Composite heartbeat index `(buddy_session_id, user_id, left_at …)` variants**: the existing unique composite already serves every observed filter shape as a left-prefix.
- **CHECK tightening (e.g. `left_at >= joined_at`)**: no observed integrity violations possible through current code paths; not worth constraint churn.

## 6. Verification that this pass was read-only

- Every statement in [`db-audit-social-buddy.sql`](./db-audit-social-buddy.sql) is a `SELECT` against `pg_catalog`, `pg_stat_*`, or `information_schema` — no DDL/DML keywords appear anywhere in the script.
- Neon MCP `run_sql` was used statement-by-statement against the default (`production`) branch; the preview branch was not touched.
- Post-audit, the `schema_migrations` ledger and all object definitions are byte-identical to the pre-audit state (nothing in the session issued writes; catalog SELECTs cannot mutate).

## 7. Re-running this audit

1. Run [`docs/db-audit-social-buddy.sql`](./db-audit-social-buddy.sql) section-by-section (each statement is self-contained; psql can run the whole file).
2. Compare Sections 2–4 output against `src/db/schema.ts` for drift.
3. Treat Section 7 `false` rows and Section 8 rows as the candidate queue; validate each against current app query patterns before filing migrations.
4. Remember the stats caveats in the script header (cumulative counters, planner seq-scan preference on small tables).
