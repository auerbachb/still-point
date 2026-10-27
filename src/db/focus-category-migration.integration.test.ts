/**
 * Issue #837 (focus activity tracking 3/5, #765) — the deployed migration
 * artifact `drizzle/sessions_focus_category_837_incremental.sql`.
 *
 * The tests replay every managed migration in the runner's order with raw SQL,
 * as `scripts/apply-migrations.ts` does, writing a user and a sit just before
 * this file runs so there are existing rows for it to leave alone. Then they
 * apply this file again. `scripts/apply-migrations.test.ts` separately runs the
 * whole chain through the real runner and its checksum ledger (#858).
 */
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FOCUS_CATEGORIES } from "@/lib/constants";
import {
  listIncrementalMigrationFiles,
  readMigrationBody,
  stripOuterTransactionWrappers,
} from "../../scripts/lib/migration-utils";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const CATEGORY_MIGRATION = "sessions_focus_category_837_incremental.sql";
const CATEGORY_CHECK = "sessions_focus_category_allowed";

const userId = "83700000-0000-4000-8000-000000000837";

async function apply(pg: PGlite, file: string): Promise<void> {
  await pg.exec(stripOuterTransactionWrappers(readMigrationBody(MIGRATIONS_DIR, file)));
}

function insertSession(pg: PGlite, sessionType: string, focusCategory: string | null) {
  return pg.query(
    `INSERT INTO sessions (user_id, day_number, session_type, duration, completed, clear_percent, session_date, focus_category)
     VALUES ($1, 1, $2, 60, true, 0, '2026-10-26', $3)`,
    [userId, sessionType, focusCategory],
  );
}

/** Replays the managed chain in runner order on an empty database. */
async function freshDatabase(): Promise<PGlite> {
  const pg = new PGlite();
  const files = listIncrementalMigrationFiles(MIGRATIONS_DIR);
  expect(files).toContain(CATEGORY_MIGRATION);
  for (const file of files) {
    if (file === CATEGORY_MIGRATION) {
      // A deployed database's rows, written before the column exists.
      await pg.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [
        userId,
        "existing837@test.local",
        "existing837",
      ]);
      await pg.query(
        `INSERT INTO sessions (user_id, day_number, session_type, duration, completed, clear_percent, session_date)
         VALUES ($1, 1, 'standard', 60, true, 80, '2026-10-25')`,
        [userId],
      );
    }
    await apply(pg, file);
  }
  return pg;
}

async function categoryChecks(pg: PGlite): Promise<string[]> {
  const { rows } = await pg.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`,
    [CATEGORY_CHECK],
  );
  return rows.map((row) => row.def);
}

async function storedCategories(pg: PGlite): Promise<Array<string | null>> {
  const { rows } = await pg.query<{ focus_category: string | null }>(
    // The existing sit is dated the day before every session these tests add.
    `SELECT focus_category FROM sessions ORDER BY session_date, focus_category NULLS FIRST`,
  );
  return rows.map((row) => row.focus_category);
}

describe("migration artifact — sessions_focus_category_837_incremental.sql", () => {
  let pg: PGlite | null = null;

  afterEach(async () => {
    await pg?.close();
    pg = null;
  });

  test("applies to a fresh database: a nullable column, existing rows left null", async () => {
    pg = await freshDatabase();

    const { rows: columns } = await pg.query<{
      data_type: string;
      character_maximum_length: number;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT data_type, character_maximum_length, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'sessions' AND column_name = 'focus_category'`,
    );
    expect(columns).toEqual([
      { data_type: "character varying", character_maximum_length: 32, is_nullable: "YES", column_default: null },
    ]);
    expect(await storedCategories(pg)).toEqual([null]);
  });

  test("the CHECK accepts the three categories and null, and rejects anything else", async () => {
    pg = await freshDatabase();

    for (const category of FOCUS_CATEGORIES) {
      await expect(insertSession(pg, "focus", category)).resolves.toBeDefined();
    }
    await expect(insertSession(pg, "focus", null)).resolves.toBeDefined();
    for (const invalid of ["Reading", "", "music", "reading "]) {
      await expect(insertSession(pg, "focus", invalid)).rejects.toThrow(CATEGORY_CHECK);
    }
  });

  test("re-applies cleanly and keeps stored categories", async () => {
    pg = await freshDatabase();
    await insertSession(pg, "focus", "writing");

    await apply(pg, CATEGORY_MIGRATION);
    await apply(pg, CATEGORY_MIGRATION);

    const checks = await categoryChecks(pg);
    expect(checks).toHaveLength(1);
    for (const category of FOCUS_CATEGORIES) {
      expect(checks[0]).toContain(`'${category}'`);
    }
    expect(await storedCategories(pg)).toEqual([null, "writing"]);
  });
});
