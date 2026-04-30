#!/usr/bin/env node
/**
 * Auth / username integration lane: applies SQL migrations, then runs Playwright
 * tests tagged @authDbIntegration against a real Postgres (POSTGRES_URL).
 * Loads `.env.local` / `.env` like other tooling so local runs match CI env shape.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(root);

const pg = process.env.POSTGRES_URL?.trim();
const jwt = process.env.JWT_SECRET?.trim();
if (!pg || !jwt) {
  console.error(
    "[e2e:authDb] POSTGRES_URL and JWT_SECRET are required (e.g. in .env.local for Neon non-prod + a dev JWT secret). See e2e/README.md.",
  );
  process.exit(1);
}

function run(cmd, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...extraEnv },
      shell: false,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
    child.on("error", reject);
  });
}

await run("npx", ["tsx", "scripts/apply-migrations.ts"]);
const parsedRepeat = Number.parseInt(process.env.E2E_REPEAT_EACH ?? "1", 10);
const repeatEach = Number.isNaN(parsedRepeat) ? 1 : Math.max(1, parsedRepeat);
await run("npx", [
  "playwright",
  "test",
  "--grep",
  "@authDbIntegration",
  "--retries",
  "2",
  "--workers",
  "1",
  "--repeat-each",
  String(repeatEach),
], { E2E_LANE: "authDb" });
