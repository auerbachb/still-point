import fs from "node:fs";
import path from "node:path";
import {
  MIGRATION_ADVISORY_LOCK_KEY,
  listIncrementalMigrationFiles,
  migrationChecksum,
  readMigrationBody,
  stripOuterTransactionWrappers,
} from "./migration-utils";

export type MigrationQueryClient = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
};

export type ApplyMigrationsResult = {
  appliedCount: number;
  skippedCount: number;
};

export type ApplyMigrationsOptions = {
  logProgress?: boolean;
};

export class MigrationChecksumMismatchError extends Error {
  constructor(file: string) {
    super(
      `[migrate] ${file} has been edited since it was applied (checksum mismatch). ` +
        "Restore the original content, or write a new migration file.",
    );
    this.name = "MigrationChecksumMismatchError";
  }
}

export async function applyIncrementalMigrations(
  client: MigrationQueryClient,
  migrationsDir: string,
  options: ApplyMigrationsOptions = {},
): Promise<ApplyMigrationsResult> {
  const logProgress = options.logProgress ?? false;
  const files = listIncrementalMigrationFiles(migrationsDir);
  if (files.length === 0) {
    return { appliedCount: 0, skippedCount: 0 };
  }

  await client.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_ADVISORY_LOCK_KEY]);

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "filename" text PRIMARY KEY,
        "checksum" text NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Map<string, string>();
    const { rows } = await client.query(`SELECT filename, checksum FROM schema_migrations`);
    for (const row of rows as Array<{ filename: string; checksum: string }>) {
      applied.set(row.filename, row.checksum);
    }

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      const body = readMigrationBody(migrationsDir, file);
      const checksum = migrationChecksum(body);
      const prior = applied.get(file);

      if (prior === checksum) {
        skippedCount++;
        continue;
      }

      if (prior && prior !== checksum) {
        throw new MigrationChecksumMismatchError(file);
      }

      const stripped = stripOuterTransactionWrappers(body);
      if (logProgress) process.stdout.write(`[migrate] ${file} ... `);
      try {
        await client.query("BEGIN");
        try {
          await client.query(stripped);
          await client.query(
            `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)
             ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
            [file, checksum],
          );
          await client.query("COMMIT");
          if (logProgress) process.stdout.write("ok\n");
          appliedCount++;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      } catch (err) {
        if (logProgress) {
          process.stdout.write("FAILED\n");
          console.error(`[migrate] ${file} failed:`, err);
        }
        throw err;
      }
    }

    return { appliedCount, skippedCount };
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_ADVISORY_LOCK_KEY]);
    } catch {
      // best-effort; the session ending also releases it.
    }
  }
}

/** Test helper: write a migration file into a temp directory. */
export function writeMigrationFile(
  migrationsDir: string,
  fileName: string,
  body: string,
): void {
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.writeFileSync(path.join(migrationsDir, fileName), body, "utf8");
}
