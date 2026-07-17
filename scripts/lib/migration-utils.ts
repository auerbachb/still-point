import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Shared with scripts/reconcile-migration-checksum.ts and apply-migrations.ts. */
export const MIGRATION_ADVISORY_LOCK_KEY = 7195279_0001;

/** Managed migrations: every *.sql except numbered drizzle-kit output. */
export function listIncrementalMigrationFiles(migrationsDir: string): string[] {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !/^\d{4}_/.test(f))
    .sort();
}

export function migrationChecksum(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function readMigrationBody(migrationsDir: string, file: string): string {
  return fs.readFileSync(path.join(migrationsDir, file), "utf8");
}

/**
 * Strip outer BEGIN/COMMIT wrappers before the runner wraps the body in its own
 * transaction. Inner BEGIN inside DO $$ ... $$ blocks is left alone.
 */
export function stripOuterTransactionWrappers(body: string): string {
  return body
    .replace(/^[ \t]*BEGIN[ \t]*;\s*$/im, "")
    .replace(/^[ \t]*COMMIT[ \t]*;\s*$/im, "");
}
