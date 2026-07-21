# Database migrations

Migrations live here as `*_incremental.sql` files and are applied by
[`scripts/apply-migrations.ts`](../scripts/apply-migrations.ts) (`npm run db:migrate`),
which runs as part of the Vercel build command on **every** deploy (preview and
production).

## How the runner works

- It applies every `*.sql` file in this directory **except** the numbered
  `0000_*.sql` drizzle-kit output (those are for local drift detection only and
  are not idempotent against an existing DB).
- Files are expected to be **idempotent** (`CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, `DO $$ ... $$` existence guards, etc.).
- When a file is first applied, its SHA-256 is recorded in the
  `schema_migrations` ledger (`filename`, `checksum`, `applied_at`).
- On later runs: a file whose checksum matches the ledger is skipped; a file not
  in the ledger is applied and recorded.
- **If a file's content changes after it was applied, the runner fails the build:**

  ```
  [migrate] <file>.sql has been edited since it was applied (checksum mismatch).
  Restore the original content, or write a new migration file.
  ```

  This guard is intentional - it stops silent schema drift. **Do not weaken it**
  in `apply-migrations.ts` to make CI pass.

## The golden rule: migrations are append-only once applied

Once a migration has been applied to **any** long-lived branch, treat it as
immutable. Need a schema change? **Add a new `*_incremental.sql` file** rather
than editing an existing one.

### Why editing an applied file breaks deploys

Vercel previews deploy against a **single, long-lived shared Neon `preview`
branch**, and production deploys against the `production` branch. Each branch
keeps its own `schema_migrations` ledger. If a migration is applied on one branch
and then edited before it reaches another, the branches disagree:

- The branch that recorded the **old** content fails the checksum guard on the
  next deploy.
- "Restore the original content" is **not** always safe - another branch may have
  already recorded the **new** content, so reverting just moves the breakage.

> Incident #368: `web_push_subscriptions_347_incremental.sql` was applied to the
> shared `preview` branch under its original #347 content, then a review fix
> (#360) hardened the FK-existence guard before it merged to `main`. `production`
> first saw the file with the new content (so it was fine), but `preview` still
> held the old checksum and every PR preview deploy failed.

**Safety net:** the shared `preview` branch is automatically reset from
`production` every night by
[`.github/workflows/neon-preview-reset.yml`](../.github/workflows/neon-preview-reset.yml)
(issue #372), so most preview drift self-heals within a day. This requires the
`NEON_API_KEY` repo secret; until it is set the workflow no-ops. `production` is
never auto-reset, so an intentionally edited applied migration there still needs
a manual reconcile (below).

## If you must change an already-applied migration

Only do this when the new content is **schema-equivalent** to what was applied
(e.g. hardening an idempotency guard) - i.e. re-running it would produce the
exact same schema. If the change alters the schema, write a **new** migration
file instead.

1. **Verify equivalence.** Confirm the new file produces the same tables /
   columns / constraints / indexes as the version already applied.
2. **Reconcile the ledger on every branch that applied the old content** -
   typically both `production` and `preview`. Use the helper (dry-run first):

   ```bash
   # point POSTGRES_URL at the branch you are reconciling
   POSTGRES_URL='<branch connection string>' npm run db:reconcile -- web_push_subscriptions_347_incremental.sql
   # review the drift, then write it:
   POSTGRES_URL='<branch connection string>' npm run db:reconcile -- web_push_subscriptions_347_incremental.sql --apply
   ```

   The helper updates the **ledger only** - it never runs DDL. It shares the
   migrator's advisory lock, so it cannot race a concurrent deploy.

3. **Preview shortcut.** The nightly workflow above usually heals preview on its
   own, but to fix it immediately: because `preview` is a disposable mirror of
   `production`, you can reset it from its parent in the Neon console (or via the
   API: `reset_from_parent`, or `neonctl branches reset preview --parent`), which
   brings its ledger and data back in line with `production` in one step. (This
   discards preview-only data - use the "preserve under name" option if you might
   need it back.)

## Bootstrapping a fresh database

Fresh/empty databases (new dev environments, ephemeral e2e branches per #316,
disaster-recovery rebuilds) can now be fully bootstrapped via:

```bash
POSTGRES_URL='<connection-string>' npm run db:migrate
```

`drizzle/0_core_tables_incremental.sql` is the bootstrap shim that makes this
work. It creates the three core tables (`users`, `sessions`, `thoughts`) that
only exist in the excluded `0000_romantic_night_nurse.sql` baseline, plus
`buddy_sessions` and `buddy_session_participants` to resolve an ordering hazard
(see below). Every statement is idempotent (`IF NOT EXISTS`, `DO $$ ... $$`
guards), so this file is a pure no-op on prod/preview where the schema already
exists.

### Sort-order convention

The runner excludes files matching `/^\d{4}_/` (exactly four digits then
underscore) and sorts the rest with a plain `.sort()`. A **single leading
digit + underscore** (e.g. `0_`) sorts before all letter-prefixed filenames
in ASCII order, yet is not matched by the four-digit exclusion — so the file
runs first.

If you ever need another "must-run-before-everything" bootstrap file, follow
the same convention (`1_`, `2_`, etc.) and document the reason.

### Ordering hazards

Some incremental files sort before the file that creates the table they touch.
The known case: `buddy_session_participants_one_host_per_session_incremental.sql`
and `buddy_session_participants_user_index_incremental.sql` sort before
`buddy_sessions_incremental.sql`, yet create indexes on `buddy_session_participants`.
The bootstrap file resolves this by creating `buddy_sessions` and
`buddy_session_participants` with their full current definitions so those index
files are no-ops on existing DBs and valid operations on fresh ones.

If you add a new table that is referenced by an earlier-sorting file, add it to
`0_core_tables_incremental.sql` following the append-only rule for that file:
wait for the file to be applied, then add a _new_ incremental file with the
additional definition (or extend the bootstrap via a separate new
`1_<name>_incremental.sql`).

### Local dev

`drizzle-kit push` remains the fastest path for local development — it
introspects `src/db/schema.ts` directly and applies the delta in one step
without the ledger overhead. Use `npm run db:migrate` when you need the
ledgered incremental path (CI, Vercel, ephemeral e2e branches).

---

## `db:reconcile` helper

[`scripts/reconcile-migration-checksum.ts`](../scripts/reconcile-migration-checksum.ts)
(`npm run db:reconcile`) compares the recorded checksum to the current file
content on the branch addressed by `POSTGRES_URL`:

- **Dry-run by default** - nothing is written without `--apply`.
- Takes an explicit `<file.sql>` or `--all`; refuses to run without `POSTGRES_URL`.
- Uses the same checksum and advisory lock as the migrator, so its view always
  matches what the migrator would compute.
