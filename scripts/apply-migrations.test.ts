import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  applyIncrementalMigrations,
  MigrationChecksumMismatchError,
  writeMigrationFile,
  type MigrationQueryClient,
} from "./lib/migration-runner";
import {
  listIncrementalMigrationFiles,
  migrationChecksum,
  readMigrationBody,
  stripOuterTransactionWrappers,
} from "./lib/migration-utils";

/** The repo's real migrations, as `npm run db:migrate` applies them. */
const REPO_MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");
const NOTIFICATION_BOOTSTRAP = "1_notification_preferences_incremental.sql";

const tempDirs: string[] = [];

function tempMigrationsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "still-point-migrate-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function withPGlite(
  fn: (client: MigrationQueryClient) => Promise<void>,
): Promise<void> {
  const pg = new PGlite();
  // PGlite's `query` takes a single statement and a migration body holds
  // several. Like the pg-protocol pool in apply-migrations.ts, send
  // parameterless SQL as a simple query (`exec`) and return the last
  // statement's rows, which is what the runner reads from its ledger SELECT.
  const client: MigrationQueryClient = {
    query: async (sql, params) => {
      if (params && params.length > 0) return pg.query(sql, params);
      const results = await pg.exec(sql);
      return { rows: results.at(-1)?.rows ?? [] };
    },
  };
  try {
    await fn(client);
  } finally {
    await pg.close();
  }
}

/**
 * Applies the repo's whole chain. The runner stops at the first failing file
 * without naming it, so a failure names the first file the ledger lacks.
 */
async function applyRepoMigrations(client: MigrationQueryClient, files: string[]) {
  try {
    return await applyIncrementalMigrations(client, REPO_MIGRATIONS_DIR);
  } catch (error) {
    const { rows } = await client.query("SELECT filename FROM schema_migrations");
    const applied = new Set((rows as { filename: string }[]).map((row) => row.filename));
    throw new Error(`${files.find((file) => !applied.has(file))} failed: ${String(error)}`);
  }
}

/** Columns, constraints, indexes and stored rows of notification_preferences. */
async function notificationPreferencesSnapshot(
  client: MigrationQueryClient,
): Promise<Record<string, unknown[]>> {
  const queries = {
    columns: `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
              FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'notification_preferences'
              ORDER BY ordinal_position`,
    constraints: `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
                  WHERE conrelid = 'public.notification_preferences'::regclass ORDER BY conname`,
    indexes: `SELECT indexname, indexdef FROM pg_indexes
              WHERE schemaname = 'public' AND tablename = 'notification_preferences'
              ORDER BY indexname`,
    rows: `SELECT * FROM notification_preferences ORDER BY user_id`,
  };
  const snapshot: Record<string, unknown[]> = {};
  for (const [key, sql] of Object.entries(queries)) {
    snapshot[key] = (await client.query(sql)).rows;
  }
  return snapshot;
}

describe("migration-utils (#539)", () => {
  test("listIncrementalMigrationFiles skips numbered drizzle-kit output", () => {
    const dir = tempMigrationsDir();
    writeMigrationFile(dir, "0000_snapshot.sql", "SELECT 1;");
    writeMigrationFile(dir, "aaa_first_incremental.sql", "SELECT 1;");
    writeMigrationFile(dir, "zzz_second_incremental.sql", "SELECT 2;");

    expect(listIncrementalMigrationFiles(dir)).toEqual([
      "aaa_first_incremental.sql",
      "zzz_second_incremental.sql",
    ]);
  });

  test("stripOuterTransactionWrappers removes only a full-file outer BEGIN/COMMIT pair", () => {
    const wrapped = [
      "BEGIN;",
      "CREATE TABLE IF NOT EXISTS demo (id int);",
      "COMMIT;",
    ].join("\n");

    expect(stripOuterTransactionWrappers(wrapped)).toBe(
      "CREATE TABLE IF NOT EXISTS demo (id int);",
    );

    const innerBeginPreserved = [
      "BEGIN;",
      "CREATE TABLE IF NOT EXISTS demo (id int);",
      "COMMIT;",
      "DO $$ BEGIN PERFORM 1; END $$;",
    ].join("\n");

    expect(stripOuterTransactionWrappers(innerBeginPreserved)).toBe(innerBeginPreserved);
  });

  test("stripOuterTransactionWrappers strips wrappers after leading SQL comments", () => {
    const wrapped = [
      "-- oauth_accounts incremental migration",
      "BEGIN;",
      "CREATE TABLE IF NOT EXISTS oauth_demo (id int);",
      "COMMIT;",
    ].join("\n");

    expect(stripOuterTransactionWrappers(wrapped)).toBe(
      "CREATE TABLE IF NOT EXISTS oauth_demo (id int);",
    );
  });

  test("migrationChecksum is stable for the same body", () => {
    const body = "CREATE TABLE IF NOT EXISTS demo (id int);";
    expect(migrationChecksum(body)).toBe(migrationChecksum(body));
    expect(migrationChecksum(`${body}\n`)).not.toBe(migrationChecksum(body));
  });
});

describe("applyIncrementalMigrations (#539)", () => {
  test("applies a new migration and records its checksum", async () => {
    const dir = tempMigrationsDir();
    writeMigrationFile(
      dir,
      "demo_table_incremental.sql",
      "CREATE TABLE IF NOT EXISTS migrate_demo (id int PRIMARY KEY);",
    );

    await withPGlite(async (client) => {
      const first = await applyIncrementalMigrations(client, dir);
      expect(first).toEqual({ appliedCount: 1, skippedCount: 0 });

      const second = await applyIncrementalMigrations(client, dir);
      expect(second).toEqual({ appliedCount: 0, skippedCount: 1 });

      const { rows } = await client.query(
        "SELECT filename, checksum FROM schema_migrations",
      );
      const migrationRows = rows as { filename: string; checksum: string }[];
      expect(migrationRows).toHaveLength(1);
      expect(migrationRows[0]!.filename).toBe("demo_table_incremental.sql");
      expect(migrationRows[0]!.checksum).toBe(
        migrationChecksum("CREATE TABLE IF NOT EXISTS migrate_demo (id int PRIMARY KEY);"),
      );
    });
  });

  test("strips outer BEGIN/COMMIT before executing under the runner transaction", async () => {
    const dir = tempMigrationsDir();
    writeMigrationFile(
      dir,
      "wrapped_demo_incremental.sql",
      [
        "BEGIN;",
        "CREATE TABLE IF NOT EXISTS wrapped_demo (label text);",
        "COMMIT;",
      ].join("\n"),
    );

    await withPGlite(async (client) => {
      await expect(applyIncrementalMigrations(client, dir)).resolves.toEqual({
        appliedCount: 1,
        skippedCount: 0,
      });

      const { rows } = await client.query(
        "SELECT to_regclass('public.wrapped_demo') AS rel",
      );
      const relRows = rows as { rel: string | null }[];
      expect(relRows[0]?.rel).toBe("wrapped_demo");
    });
  });

  test("fails when an applied migration file changes", async () => {
    const dir = tempMigrationsDir();
    const file = "drift_guard_incremental.sql";
    writeMigrationFile(dir, file, "CREATE TABLE IF NOT EXISTS drift_guard (id int);");

    await withPGlite(async (client) => {
      await applyIncrementalMigrations(client, dir);
      writeMigrationFile(dir, file, "CREATE TABLE IF NOT EXISTS drift_guard (id int, note text);");

      await expect(applyIncrementalMigrations(client, dir)).rejects.toBeInstanceOf(
        MigrationChecksumMismatchError,
      );
    });
  });

  test("applies the whole drizzle/ chain to an empty database, then skips all of it (#858)", async () => {
    const files = listIncrementalMigrationFiles(REPO_MIGRATIONS_DIR);
    // The bootstrap needs `users` from 0_core and has to run before every
    // notification_preferences_* file, since it supplies their columns.
    const bootstrapAt = files.indexOf(NOTIFICATION_BOOTSTRAP);
    expect(bootstrapAt).toBeGreaterThan(files.indexOf("0_core_tables_incremental.sql"));
    expect(bootstrapAt).toBeLessThan(
      files.findIndex((file) => file.startsWith("notification_preferences_")),
    );

    await withPGlite(async (client) => {
      await expect(applyRepoMigrations(client, files)).resolves.toEqual({
        appliedCount: files.length,
        skippedCount: 0,
      });
      await expect(applyRepoMigrations(client, files)).resolves.toEqual({
        appliedCount: 0,
        skippedCount: files.length,
      });

      // The columns _531 indexes and _709 alters, with #709's final default.
      const { rows } = await client.query(
        `SELECT column_name, column_default FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'notification_preferences'
           AND column_name IN ('failure_reason_reminder_enabled', 'suppress_during_session')
         ORDER BY column_name`,
      );
      expect(rows).toEqual([
        { column_name: "failure_reason_reminder_enabled", column_default: "false" },
        { column_name: "suppress_during_session", column_default: "true" },
      ]);
    });
  });

  test("the notification_preferences bootstrap leaves an existing table untouched (#858)", async () => {
    const userId = "85800000-0000-4000-8000-000000000001";

    await withPGlite(async (client) => {
      // An existing table, built by the applied files that add both columns, in
      // merge order. suppress_during_session keeps #431's false default, where
      // the bootstrap declares true.
      await client.query(`CREATE TABLE users (id uuid PRIMARY KEY)`);
      for (const file of [
        "notification_preferences_345_incremental.sql",
        "notification_preferences_suppress_during_session_431_incremental.sql",
        "notification_preferences_failure_reason_441_incremental.sql",
      ]) {
        await client.query(readMigrationBody(REPO_MIGRATIONS_DIR, file));
      }
      await client.query(`INSERT INTO users (id) VALUES ($1)`, [userId]);
      await client.query(
        `INSERT INTO notification_preferences (user_id, push_enabled, updated_at)
         VALUES ($1, true, '2026-01-02T03:04:05Z')`,
        [userId],
      );
      const before = await notificationPreferencesSnapshot(client);
      expect(before.columns).toContainEqual(
        expect.objectContaining({ column_name: "suppress_during_session", column_default: "false" }),
      );

      // Applied the way a deploy applies it there: a new file the ledger lacks.
      const dir = tempMigrationsDir();
      writeMigrationFile(
        dir,
        NOTIFICATION_BOOTSTRAP,
        readMigrationBody(REPO_MIGRATIONS_DIR, NOTIFICATION_BOOTSTRAP),
      );
      await expect(applyIncrementalMigrations(client, dir)).resolves.toEqual({
        appliedCount: 1,
        skippedCount: 0,
      });

      expect(await notificationPreferencesSnapshot(client)).toEqual(before);
    });
  });
});
