import { loadEnvConfig } from "@next/env";
import { Pool, neonConfig } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import ws from "ws";
import {
  MIGRATION_ADVISORY_LOCK_KEY,
  listIncrementalMigrationFiles,
  migrationChecksum,
  readMigrationBody,
} from "./lib/migration-utils";

loadEnvConfig(process.cwd());

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

function usage(message?: string): never {
  if (message) console.error(`[reconcile] ${message}\n`);
  console.error(
    "Reconcile the schema_migrations checksum ledger to match the current\n" +
      "migration file content on the branch addressed by POSTGRES_URL.\n\n" +
      "Usage:\n" +
      "  POSTGRES_URL=... npm run db:reconcile -- <file.sql>            # dry-run one file\n" +
      "  POSTGRES_URL=... npm run db:reconcile -- --all                 # dry-run every file\n" +
      "  POSTGRES_URL=... npm run db:reconcile -- <file.sql> --apply    # write\n\n" +
      "Dry-run is the default; nothing is written without --apply.\n" +
      "This updates the LEDGER ONLY - it never runs DDL. Reconcile a migration\n" +
      "ONLY after verifying its new content produces the same schema as what was\n" +
      "already applied (e.g. an idempotent-guard tweak). See drizzle/README.md.",
  );
  process.exit(2);
}

function checksumOf(file: string): string {
  // Identical to the runner: sha256 of the raw file body (pre any BEGIN/COMMIT
  // stripping, which only affects the executed SQL, not the checksum).
  return migrationChecksum(readMigrationBody(MIGRATIONS_DIR, file));
}

function isUndefinedTable(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "42P01"
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const all = argv.includes("--all");
  const positionals = argv.filter((a) => !a.startsWith("--"));

  if (all && positionals.length > 0) usage("Pass either --all or a filename, not both.");
  if (!all && positionals.length === 0) usage("Specify a migration filename or --all.");
  if (positionals.length > 1) usage("Specify exactly one migration filename.");

  const url = process.env.POSTGRES_URL;
  if (!url) usage("POSTGRES_URL is required (point it at the branch you want to reconcile).");

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`[reconcile] ${MIGRATIONS_DIR} not found.`);
    process.exit(1);
  }

  let targets: string[];
  if (all) {
    targets = listIncrementalMigrationFiles(MIGRATIONS_DIR);
  } else {
    // Accept "drizzle/foo.sql" or "foo.sql".
    const name = path.basename(positionals[0]);
    if (/^\d{4}_/.test(name)) usage(`Numbered migrations are not managed by the runner: ${name}`);
    if (!fs.existsSync(path.join(MIGRATIONS_DIR, name))) usage(`No such migration file: drizzle/${name}`);
    targets = [name];
  }

  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url });
  console.log(`[reconcile] Connecting to host=${new URL(url).host}`);
  console.log(`[reconcile] Mode: ${apply ? "APPLY (will write)" : "dry-run (no writes)"}`);

  // pg_advisory_lock is session-scoped: the lock and every query must run on the
  // same checked-out client (matches apply-migrations.ts).
  const client = await pool.connect();
  let lockHeld = false;
  let drift = 0;
  let reconciled = 0;

  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [MIGRATION_ADVISORY_LOCK_KEY]);
    lockHeld = true;

    const ledger = new Map<string, string>();
    try {
      const { rows } = await client.query<{ filename: string; checksum: string }>(
        `SELECT filename, checksum FROM schema_migrations`,
      );
      for (const row of rows) ledger.set(row.filename, row.checksum);
    } catch (err) {
      if (isUndefinedTable(err)) {
        console.log(
          "[reconcile] No schema_migrations table on this branch - nothing applied yet, nothing to reconcile.",
        );
        return;
      }
      throw err;
    }

    for (const file of targets) {
      const fileChecksum = checksumOf(file);
      const recorded = ledger.get(file);

      if (recorded === undefined) {
        if (!all) {
          console.log(
            `[reconcile] ${file}: not applied on this branch - the migrator will apply it on the next run. Nothing to reconcile.`,
          );
        }
        continue;
      }
      if (recorded === fileChecksum) {
        if (!all) console.log(`[reconcile] ${file}: in sync (${fileChecksum}).`);
        continue;
      }

      drift++;
      console.log(`[reconcile] ${file}: DRIFT`);
      console.log(`             recorded: ${recorded}`);
      console.log(`             file:     ${fileChecksum}`);

      if (!apply) {
        console.log("             -> would reconcile (re-run with --apply).");
        continue;
      }

      await client.query("BEGIN");
      try {
        // Ledger-only update - touches no schema object. The `AND checksum = $3`
        // guard makes this a no-op if a concurrent deploy/reconcile already moved
        // the row, so we never clobber an unexpected value.
        const res = await client.query(
          `UPDATE schema_migrations SET checksum = $2 WHERE filename = $1 AND checksum = $3`,
          [file, fileChecksum, recorded],
        );
        await client.query("COMMIT");
        if (res.rowCount === 1) {
          reconciled++;
          console.log("             -> reconciled.");
        } else {
          console.log("             -> skipped (ledger changed under us; re-run to re-check).");
        }
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log(
      `[reconcile] done. drift=${drift} ${apply ? `reconciled=${reconciled}` : "(dry-run; no writes)"}`,
    );
    if (!apply && drift > 0) {
      console.log(
        "[reconcile] Re-run with --apply to write. ONLY do this after confirming the new file",
      );
      console.log(
        "[reconcile] content yields the same schema as what was applied. See drizzle/README.md.",
      );
    }
  } finally {
    if (lockHeld) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [MIGRATION_ADVISORY_LOCK_KEY]);
      } catch {
        // best-effort; the session ending also releases it.
      }
    }
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
