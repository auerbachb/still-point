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
  stripOuterTransactionWrappers,
} from "./lib/migration-utils";

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
  const client: MigrationQueryClient = {
    query: (sql, params) => pg.query(sql, params),
  };
  try {
    await fn(client);
  } finally {
    await pg.close();
  }
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

      const { rows } = await client.query<{ filename: string; checksum: string }>(
        "SELECT filename, checksum FROM schema_migrations",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.filename).toBe("demo_table_incremental.sql");
      expect(rows[0]!.checksum).toBe(
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

      const { rows } = await client.query<{ rel: string | null }>(
        "SELECT to_regclass('public.wrapped_demo') AS rel",
      );
      expect(rows[0]?.rel).toBe("wrapped_demo");
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
});
