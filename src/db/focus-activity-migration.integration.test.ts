/**
 * Issue #835 (focus activity tracking 1/5, #765) — the deployed migration
 * artifact `drizzle/sessions_type_focus_activity_835_incremental.sql`.
 *
 * `sessions_breath_count_incremental.sql` DROPs and re-ADDs the same
 * session-type CHECK with three values, so the widening only survives on a
 * fresh database if this file runs after it. The tests replay, in the runner's
 * order, every managed migration that touches that CHECK (this one included)
 * with raw SQL, as `scripts/apply-migrations.ts` does, then apply this one again.
 *
 * The whole `drizzle/` chain is not replayed here: it does not bootstrap an
 * empty database today, for reasons unrelated to this migration.
 */
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  listIncrementalMigrationFiles,
  readMigrationBody,
  stripOuterTransactionWrappers,
} from "../../scripts/lib/migration-utils";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const FOCUS_MIGRATION = "sessions_type_focus_activity_835_incremental.sql";
const SESSION_TYPE_CHECK = "sessions_session_type_allowed";

const userId = "33333333-3333-4333-8333-333333333333";

/** Managed migrations that touch the session-type CHECK, in the order the runner applies them. */
const checkMigrations = listIncrementalMigrationFiles(MIGRATIONS_DIR).filter((file) =>
  readMigrationBody(MIGRATIONS_DIR, file).includes(SESSION_TYPE_CHECK),
);

async function apply(pg: PGlite, file: string): Promise<void> {
  await pg.exec(stripOuterTransactionWrappers(readMigrationBody(MIGRATIONS_DIR, file)));
}

function insertSession(pg: PGlite, sessionType: string) {
  return pg.query(
    `INSERT INTO sessions (user_id, day_number, session_type, duration, completed, clear_percent, session_date)
     VALUES ($1, 1, $2, 60, true, 0, '2026-10-26')`,
    [userId, sessionType],
  );
}

/**
 * Replays the CHECK migrations in runner order. Just before this one runs, it
 * writes a pre-#835 user and sit and confirms the old CHECK rejects `focus`.
 */
async function freshDatabase(): Promise<PGlite> {
  const pg = new PGlite();
  for (const file of checkMigrations) {
    if (file === FOCUS_MIGRATION) {
      await pg.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [
        userId,
        "existing835@test.local",
        "existing835",
      ]);
      await insertSession(pg, "standard");
      await expect(insertSession(pg, "focus")).rejects.toThrow(SESSION_TYPE_CHECK);
    }
    await apply(pg, file);
  }
  return pg;
}

async function sessionTypeCheckDefinitions(pg: PGlite): Promise<string[]> {
  const { rows } = await pg.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`,
    [SESSION_TYPE_CHECK],
  );
  return rows.map((row) => row.def);
}

async function focusActivityDays(pg: PGlite): Promise<number[]> {
  const { rows } = await pg.query<{ focus_activity_day: number }>(
    `SELECT focus_activity_day FROM users ORDER BY created_at`,
  );
  return rows.map((row) => row.focus_activity_day);
}

describe("migration artifact — sessions_type_focus_activity_835_incremental.sql", () => {
  let pg: PGlite | null = null;

  afterEach(async () => {
    await pg?.close();
    pg = null;
  });

  test("is the last managed migration to touch the session-type CHECK", () => {
    expect(checkMigrations).toEqual(
      expect.arrayContaining([
        "0_core_tables_incremental.sql",
        "sessions_breath_count_incremental.sql",
        "sessions_session_type_incremental.sql",
        FOCUS_MIGRATION,
      ]),
    );
    expect(checkMigrations.at(-1)).toBe(FOCUS_MIGRATION);
  });

  test("applies to a fresh database: existing users start at 1 and the CHECK accepts focus", async () => {
    pg = await freshDatabase();

    expect(await focusActivityDays(pg)).toEqual([1]);
    const { rows: columns } = await pg.query<{
      data_type: string;
      is_nullable: string;
      column_default: string;
    }>(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'focus_activity_day'`,
    );
    expect(columns).toEqual([{ data_type: "integer", is_nullable: "NO", column_default: "1" }]);

    for (const allowed of ["focus", "standard", "quick", "breath"]) {
      await expect(insertSession(pg, allowed)).resolves.toBeDefined();
    }
    await expect(insertSession(pg, "Focus")).rejects.toThrow(SESSION_TYPE_CHECK);
    await expect(insertSession(pg, "reading")).rejects.toThrow(SESSION_TYPE_CHECK);
  });

  test("re-applies cleanly and keeps stored goal counters and focus sessions", async () => {
    pg = await freshDatabase();
    await pg.query(`UPDATE users SET focus_activity_day = 4 WHERE id = $1`, [userId]);
    await insertSession(pg, "focus");

    await apply(pg, FOCUS_MIGRATION);
    await apply(pg, FOCUS_MIGRATION);

    expect(await focusActivityDays(pg)).toEqual([4]);
    const definitions = await sessionTypeCheckDefinitions(pg);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toContain("'focus'");
    const { rows } = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM sessions WHERE session_type = 'focus'`,
    );
    expect(rows[0]!.n).toBe(1);
  });
});
