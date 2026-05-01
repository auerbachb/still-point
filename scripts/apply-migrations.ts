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
    // In CI / Vercel builds, missing POSTGRES_URL must fail the build — silently
    // skipping would let schema drift ship to prod. Use SKIP_DB_MIGRATIONS=1 to opt out.
    if (process.env.VERCEL || process.env.CI) {
      throw new Error(
        "[migrate] POSTGRES_URL is required in CI/Vercel builds. " +
        "Set the env var, or set SKIP_DB_MIGRATIONS=1 to intentionally skip.",
      );
    }
    console.warn("[migrate] POSTGRES_URL not set — skipping (local dev without DB).");
    return;
  }

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn(`[migrate] ${MIGRATIONS_DIR} not found — nothing to apply.`);
    return;
  }

  // `drizzle-kit generate` writes numbered files (`0000_*.sql`) plus `meta/` for
  // drift detection; production was built from `*_incremental.sql` + `push`.
  // Do not execute numbered migrations here — they are not idempotent on
  // existing databases and would fail with "already exists".
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !/^\d{4}_/.test(f))
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

  // pg_advisory_lock is session-scoped, so the lock and every migration query
  // must run on the *same* checked-out client. pool.query() can pick a different
  // backend connection per call, which would silently break the lock.
  const client = await pool.connect();
  const ADVISORY_LOCK_KEY = 7195279_0001;
  let lockHeld = false;

  try {
    await client.query(`SELECT pg_advisory_lock($1)`, [ADVISORY_LOCK_KEY]);
    lockHeld = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "filename" text PRIMARY KEY,
        "checksum" text NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Map<string, string>();
    const { rows } = await client.query<{ filename: string; checksum: string }>(
      `SELECT filename, checksum FROM schema_migrations`,
    );
    for (const row of rows) applied.set(row.filename, row.checksum);

    let appliedCount = 0;
    let skippedCount = 0;

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

      // Not yet recorded. Run it. Idempotent files re-applied to a hand-migrated
      // DB are safe — this also backfills the journal for migrations that were
      // applied out-of-band before this runner existed.
      //
      // Strip any outer BEGIN/COMMIT the file ships with (a few files manage
      // their own transactions), since we wrap the body + journal write in a
      // single transaction below to keep them atomic. Inner BEGIN inside
      // DO $$ ... $$ blocks is left alone (matches start-of-line only).
      const stripped = body.replace(/^[ \t]*BEGIN[ \t]*;\s*$/im, "").replace(/^[ \t]*COMMIT[ \t]*;\s*$/im, "");
      process.stdout.write(`[migrate] ${file} ... `);
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
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
        process.stdout.write("ok\n");
        appliedCount++;
      } catch (err) {
        process.stdout.write("FAILED\n");
        console.error(`[migrate] ${file} failed:`, err);
        throw err;
      }
    }

    console.log(`[migrate] done. applied=${appliedCount} skipped=${skippedCount}`);
  } finally {
    if (lockHeld) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]);
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
