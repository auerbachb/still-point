import { loadEnvConfig } from "@next/env";
import { Pool, neonConfig } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import ws from "ws";
import { applyIncrementalMigrations } from "./lib/migration-runner";
import { listIncrementalMigrationFiles } from "./lib/migration-utils";

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

  const files = listIncrementalMigrationFiles(MIGRATIONS_DIR);
  if (files.length === 0) {
    console.log("[migrate] No managed incremental migration files in drizzle/ — nothing to apply.");
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

  try {
    const { appliedCount, skippedCount } = await applyIncrementalMigrations(
      client,
      MIGRATIONS_DIR,
      { logProgress: true },
    );
    console.log(`[migrate] done. applied=${appliedCount} skipped=${skippedCount}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
