/**
 * Issue #948 — the deployed migration artifact
 * `drizzle/thoughts_client_thought_id_948_incremental.sql`.
 *
 * Production's `thoughts` table predates the column, so the tests build one
 * without it from the bootstrap file that first creates the table, store a
 * thought, then apply this migration with raw SQL, as `scripts/apply-migrations.ts`
 * does. The PGlite route tests build their schema from `src/db/schema.ts`
 * instead, so the last tests run the batch route's own write
 * (`atomicReplaceCompletionNoteAndInsertThoughts`) against the table this file
 * builds: its ON CONFLICT clause has to name this index, not only the one
 * schema.ts declares.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  listIncrementalMigrationFiles,
  readMigrationBody,
  stripOuterTransactionWrappers,
} from "../../scripts/lib/migration-utils";

// The database each test builds, read by `atomic.ts` through `@/db`.
const testDb = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/db", () => ({
  get db() {
    return testDb.current;
  },
}));

import { atomicReplaceCompletionNoteAndInsertThoughts } from "./atomic";

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const BOOTSTRAP = "0_core_tables_incremental.sql";
const THOUGHT_ID_MIGRATION = "thoughts_client_thought_id_948_incremental.sql";

const userId = "94800000-0000-4000-8000-0000000000a1";
const otherUserId = "94800000-0000-4000-8000-0000000000a2";
const sessionId = "94800000-0000-4000-8000-0000000000b1";
const otherSessionId = "94800000-0000-4000-8000-0000000000b2";
const firstId = "94800000-0000-4000-8000-000000000001";
const secondId = "94800000-0000-4000-8000-000000000002";

async function apply(pg: PGlite, file: string): Promise<void> {
  await pg.exec(stripOuterTransactionWrappers(readMigrationBody(MIGRATIONS_DIR, file)));
}

function insertThought(pg: PGlite, owner: string, session: string, clientThoughtId: string | null) {
  return pg.query(
    `INSERT INTO thoughts (user_id, session_id, day_number, time_in_session, text, client_thought_id)
     VALUES ($1, $2, 1, 12, 'phone buzzed', $3)`,
    [owner, session, clientThoughtId],
  );
}

async function storedThoughts(pg: PGlite) {
  const { rows } = await pg.query<{ text: string; time_in_session: number; client_thought_id: string | null }>(
    `SELECT time_in_session, text, client_thought_id FROM thoughts ORDER BY time_in_session, text, client_thought_id`,
  );
  return rows;
}

async function columnAndIndex(pg: PGlite) {
  const columns = await pg.query<{ data_type: string; is_nullable: string }>(
    `SELECT data_type, is_nullable FROM information_schema.columns
     WHERE table_name = 'thoughts' AND column_name = 'client_thought_id'`,
  );
  const indexes = await pg.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes
     WHERE tablename = 'thoughts' AND indexname = 'thoughts_user_client_thought_unique'`,
  );
  return { columns: columns.rows, indexes: indexes.rows.map((row) => row.indexdef) };
}

/** A `thoughts` table without the column, holding one thought from before #948,
 *  with a sit for each of two users. */
async function databaseWithoutColumn(): Promise<PGlite> {
  const pg = new PGlite();
  await apply(pg, BOOTSTRAP);
  for (const [user, session, label] of [
    [userId, sessionId, "existing948"],
    [otherUserId, otherSessionId, "other948"],
  ] as const) {
    await pg.query(`INSERT INTO users (id, email, username) VALUES ($1, $2, $3)`, [
      user,
      `${label}@test.local`,
      label,
    ]);
    await pg.query(
      `INSERT INTO sessions (id, user_id, day_number, session_type, duration, completed, clear_percent, session_date)
       VALUES ($1, $2, 1, 'standard', 60, true, 0, '2026-10-27')`,
      [session, user],
    );
  }
  await pg.query(
    `INSERT INTO thoughts (user_id, session_id, day_number, time_in_session, text)
     VALUES ($1, $2, 1, 5, 'from before #948')`,
    [userId, sessionId],
  );
  return pg;
}

describe("migration artifact — thoughts_client_thought_id_948_incremental.sql", () => {
  let pg: PGlite | null = null;

  afterEach(async () => {
    testDb.current = null;
    await pg?.close();
    pg = null;
  });

  test("runs after the bootstrap file that creates the thoughts table", () => {
    const files = listIncrementalMigrationFiles(MIGRATIONS_DIR);
    expect(files).toContain(BOOTSTRAP);
    expect(files).toContain(THOUGHT_ID_MIGRATION);
    expect(files.indexOf(THOUGHT_ID_MIGRATION)).toBeGreaterThan(files.indexOf(BOOTSTRAP));
  });

  test("adds the nullable column and its index to a table that lacks them, and existing thoughts keep no id", async () => {
    pg = await databaseWithoutColumn();
    expect(await columnAndIndex(pg)).toEqual({ columns: [], indexes: [] });

    await apply(pg, THOUGHT_ID_MIGRATION);

    expect(await columnAndIndex(pg)).toEqual({
      columns: [{ data_type: "uuid", is_nullable: "YES" }],
      indexes: [
        "CREATE UNIQUE INDEX thoughts_user_client_thought_unique ON public.thoughts USING btree (user_id, client_thought_id) WHERE (client_thought_id IS NOT NULL)",
      ],
    });
    expect(await storedThoughts(pg)).toEqual([
      { time_in_session: 5, text: "from before #948", client_thought_id: null },
    ]);
  });

  test("re-applies cleanly and keeps stored thoughts and their ids", async () => {
    pg = await databaseWithoutColumn();
    await apply(pg, THOUGHT_ID_MIGRATION);
    await insertThought(pg, userId, sessionId, firstId);

    await apply(pg, THOUGHT_ID_MIGRATION);
    await apply(pg, THOUGHT_ID_MIGRATION);

    expect((await columnAndIndex(pg)).indexes).toHaveLength(1);
    expect(await storedThoughts(pg)).toEqual([
      { time_in_session: 5, text: "from before #948", client_thought_id: null },
      { time_in_session: 12, text: "phone buzzed", client_thought_id: firstId },
    ]);
  });

  test("allows one row per user per id: NULLs repeat, and two users may hold the same id", async () => {
    pg = await databaseWithoutColumn();
    await apply(pg, THOUGHT_ID_MIGRATION);

    await insertThought(pg, userId, sessionId, firstId);
    await expect(insertThought(pg, userId, sessionId, firstId)).rejects.toThrow(/thoughts_user_client_thought_unique/);
    await insertThought(pg, userId, sessionId, null);
    await insertThought(pg, userId, sessionId, null);
    await insertThought(pg, otherUserId, otherSessionId, firstId);

    const { rows } = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM thoughts`);
    expect(rows[0]!.n).toBe(5);
  });

  test.each([
    ["the plain insert", null],
    ["the insert that replaces the end note", { timeInSession: -1, text: "end note" }],
  ])("the batch write through %s stores a replayed thought once on this table", async (_label, completionNote) => {
    pg = await databaseWithoutColumn();
    await apply(pg, THOUGHT_ID_MIGRATION);
    testDb.current = drizzle(pg);
    const rowsToInsert = [
      { timeInSession: 12, text: "phone buzzed", clientThoughtId: firstId },
      { timeInSession: 47, text: "breathing settled", clientThoughtId: secondId },
      ...(completionNote ? [completionNote] : []),
    ];
    const write = () =>
      atomicReplaceCompletionNoteAndInsertThoughts({
        userId,
        sessionId,
        dayNumber: 1,
        clearCompletionNote: false,
        completionNote,
        rowsToInsert,
      });

    expect(await write()).toHaveLength(rowsToInsert.length);
    // Sent again: the thoughts are skipped and only the note is written anew.
    expect(await write()).toHaveLength(completionNote ? 1 : 0);

    expect(await storedThoughts(pg)).toEqual([
      ...(completionNote ? [{ time_in_session: -1, text: "end note", client_thought_id: null }] : []),
      { time_in_session: 5, text: "from before #948", client_thought_id: null },
      { time_in_session: 12, text: "phone buzzed", client_thought_id: firstId },
      { time_in_session: 47, text: "breathing settled", client_thought_id: secondId },
    ]);
  });
});
