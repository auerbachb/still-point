import { loadEnvConfig } from "@next/env";
import { Pool, neonConfig } from "@neondatabase/serverless";
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
    if (process.env.VERCEL || process.env.CI) {
      throw new Error("[migrate] POSTGRES_URL is required in CI/Vercel builds.");
    }
    console.warn("[migrate] POSTGRES_URL not set — skipping (local dev without DB).");
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
  console.log(`[migrate] Applying ${files.length} migration file(s) to host=${new URL(url).host}`);

  try {
    for (const file of files) {
      const body = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`[migrate] ${file} ... `);
      try {
        await pool.query(body);
        process.stdout.write("ok\n");
      } catch (err) {
        process.stdout.write("FAILED\n");
        console.error(`[migrate] ${file} failed:`, err);
        throw err;
      }
    }
    console.log("[migrate] All migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
