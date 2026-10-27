/**
 * Issue #890 (combine today's sits 1/5, #769) — the deployed migration artifact
 * `drizzle/sessions_combined_769_incremental.sql`.
 *
 * Production's `sessions` table predates the column, so the tests build one
 * without it from the bootstrap file that first creates the table, store a sit,
 * then apply this migration with raw SQL, as `scripts/apply-migrations.ts` does.
 * The column must match `src/db/schema.ts` (boolean, NOT NULL, default false),
 * which the PGlite route tests build their schema from.
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
const BOOTSTRAP = "0_core_tables_incremental.sql";
const COMBINED_MIGRATION = "sessions_combined_769_incremental.sql";

const userId = "89000000-0000-4000-8000-000000000890";

async function apply(pg: PGlite, file: string): Promise<void> {
  await pg.exec(stripOuterTransactionWrappers(readMigrationBody(MIGRATIONS_DIR, file)));
}

function insertSession(pg: PGlite, sessionDate: string) {
  return pg.query(
    `INSERT INTO sessions (user_id, day_number, session_type, duration, completed, clear_percent, session_date)
     VALUES ($1, 1, 'standard', 60, true, 0, $2)`,
    [userId, sessionDate],
  );
}

async function combinedColumn(pg: PGlite) {
  const { rows } = await pg.query<{
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_name = 'sessions' AND column_name = 'combined'`,
  );
  return rows;
}

async function storedSits(pg: PGlite) {
  const { rows } = await pg.query<{ session_date: string; combined: boolean }>(
    `SELECT to_char(session_date, 'YYYY-MM-DD') AS session_date, combined
     FROM sessions ORDER BY session_date`,
  );
  return rows;
}

/** A `sessions` table without the column, holding one sit from before #890. */
async function databaseWithoutColumn(): Promise<PGlite> {
  const pg = new PGlite();
  await apply(pg, BOOTSTRAP);
  await pg.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [
    userId,
    "existing890@test.local",
    "existing890",
  ]);
  await insertSession(pg, "2026-10-25");
  return pg;
}

describe("migration artifact — sessions_combined_769_incremental.sql", () => {
  let pg: PGlite | null = null;

  afterEach(async () => {
    await pg?.close();
    pg = null;
  });

  test("runs after the bootstrap file that creates the sessions table", () => {
    const files = listIncrementalMigrationFiles(MIGRATIONS_DIR);
    expect(files).toContain(BOOTSTRAP);
    expect(files).toContain(COMBINED_MIGRATION);
    expect(files.indexOf(COMBINED_MIGRATION)).toBeGreaterThan(files.indexOf(BOOTSTRAP));
  });

  test("adds the column to a table that lacks it, and existing sits read combined = false", async () => {
    pg = await databaseWithoutColumn();
    expect(await combinedColumn(pg)).toEqual([]);

    await apply(pg, COMBINED_MIGRATION);

    expect(await combinedColumn(pg)).toEqual([
      { data_type: "boolean", is_nullable: "NO", column_default: "false" },
    ]);
    expect(await storedSits(pg)).toEqual([{ session_date: "2026-10-25", combined: false }]);

    // A write that names no value gets the default, the way every existing
    // insert path (buddy sits included) writes.
    await insertSession(pg, "2026-10-26");
    expect(await storedSits(pg)).toEqual([
      { session_date: "2026-10-25", combined: false },
      { session_date: "2026-10-26", combined: false },
    ]);
  });

  test("re-applies cleanly and keeps stored combined sits", async () => {
    pg = await databaseWithoutColumn();
    await apply(pg, COMBINED_MIGRATION);
    await pg.query(
      `INSERT INTO sessions (user_id, day_number, session_type, duration, completed, clear_percent, session_date, combined)
       VALUES ($1, 56, 'standard', 680, true, 90, '2026-10-26', true)`,
      [userId],
    );

    await apply(pg, COMBINED_MIGRATION);
    await apply(pg, COMBINED_MIGRATION);

    expect(await combinedColumn(pg)).toHaveLength(1);
    expect(await storedSits(pg)).toEqual([
      { session_date: "2026-10-25", combined: false },
      { session_date: "2026-10-26", combined: true },
    ]);
  });
});
