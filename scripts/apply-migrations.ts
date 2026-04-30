import { loadEnvConfig } from "@next/env";
import { Pool, neonConfig } from "@neondatabase/serverless";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ws from "ws";

loadEnvConfig(process.cwd());

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

async function main() {
  if (process.env.SKIP_DB_MIGRATIONS === "1") {
    console.log("[migrate] SKIP_DB_MIGRATIONS=1 — skipping.");
    return;
  }

  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.warn("[migrate] POSTGRES_URL not set — skipping (set SKIP_DB_MIGRATIONS=1 to silence).");
    return;
  }

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn(`[migrate] ${MIGRATIONS_DIR} not found — nothing to apply.`);
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("[migrate] No .sql files in drizzle/ — nothing to apply.");
    return;
  }

  // The pg-protocol pool supports multi-statement query strings, including
  // DO $$ ... $$ blocks where intra-block semicolons are not statement boundaries.
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: url });
  console.log(`[migrate] Connecting to host=${new URL(url).host}`);

  // pg session-level advisory lock — serializes concurrent migration runs across
  // processes (e.g., overlapping Vercel deploys, dev + CI hitting the same DB).
  // Released automatically when the session ends; we also unlock explicitly below.
  // Key is an arbitrary 64-bit int unique to this runner.
  const ADVISORY_LOCK_KEY = 7195279_0001;
  let lockHeld = false;

  try {
    await pool.query(`SELECT pg_advisory_lock($1)`, [ADVISORY_LOCK_KEY]);
    lockHeld = true;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "filename" text PRIMARY KEY,
        "checksum" text NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Map<string, string>();
    const { rows } = await pool.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM schema_migrations`,
    );
    for (const row of rows) applied.set(row.filename, row.checksum);

    let appliedCount = 0;
    let skippedCount = 0;
    let backfilledCount = 0;

    for (const file of files) {
      const body = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = crypto.createHash("sha256").update(body).digest("hex");
      const prior = applied.get(file);

      if (prior === checksum) {
        skippedCount++;
        continue;
      }

      if (prior && prior !== checksum) {
        // The file was applied, but its content changed. We cannot safely re-run
        // (intent unknown). Fail loudly so the human can decide.
        throw new Error(
          `[migrate] ${file} has been edited since it was applied (checksum mismatch). ` +
          `Restore the original content, or write a new migration file.`,
        );
      }

      // Not yet recorded. Run it (idempotent files re-applied to a hand-migrated
      // DB are safe — this also backfills the journal for migrations that were
      // applied out-of-band).
      process.stdout.write(`[migrate] ${file} ... `);
      try {
        await pool.query(body);
        await pool.query(
          `INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)
           ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
          [file, checksum],
        );
        process.stdout.write("ok\n");
        appliedCount++;
        if (rows.length > 0 && !prior) backfilledCount++;
      } catch (err) {
        process.stdout.write("FAILED\n");
        console.error(`[migrate] ${file} failed:`, err);
        throw err;
      }
    }

    console.log(
      `[migrate] done. applied=${appliedCount} skipped=${skippedCount} backfilled=${backfilledCount}`,
    );
  } finally {
    if (lockHeld) {
      try {
        await pool.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]);
      } catch {
        // best-effort; the session ending also releases it.
      }
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
