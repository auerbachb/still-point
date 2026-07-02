#!/usr/bin/env node
/**
 * Ensures the dedicated Neon `staging` branch exists in the non-production project.
 * Refuses to run against the production Neon project (noisy-cell-87641627).
 *
 * Usage:
 *   NEON_API_KEY=… NEON_NONPROD_PROJECT_ID=… node scripts/infra/ensure-neon-staging-branch.mjs
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, "../../infra/web-staging.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const apiKey = process.env.NEON_API_KEY?.trim();
const projectId = process.env.NEON_NONPROD_PROJECT_ID?.trim();
const branchName = config.neon.branchName;
const parentBranch = config.neon.parentBranch;
const forbiddenProdProjectId = config.neon.forbiddenProdProjectId;

if (!apiKey) {
  console.error("NEON_API_KEY is required.");
  process.exit(1);
}

if (!projectId) {
  console.error(
    `${config.neon.nonprodProjectIdSecret} is required (still-point-nonprod project id).`,
  );
  process.exit(1);
}

if (projectId === forbiddenProdProjectId) {
  console.error(
    `Refusing to create staging branch in production Neon project ${forbiddenProdProjectId}.`,
  );
  process.exit(1);
}

function runNeonctl(args) {
  const result = spawnSync("npx", ["-y", "neonctl@2.22.0", ...args], {
    env: { ...process.env, NEON_API_KEY: apiKey },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || `neonctl ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

function branchExists() {
  const listOutput = runNeonctl([
    "branches",
    "list",
    "--project-id",
    projectId,
    "--output",
    "json",
  ]);
  const branches = JSON.parse(listOutput || "[]");
  return branches.some(
    (branch) =>
      branch.name === branchName ||
      branch.branch?.name === branchName ||
      branch.id === branchName,
  );
}

if (branchExists()) {
  console.log(`Neon branch '${branchName}' already exists in project ${projectId}.`);
  process.exit(0);
}

try {
  runNeonctl([
    "branches",
    "create",
    "--project-id",
    projectId,
    "--name",
    branchName,
    "--parent",
    parentBranch,
  ]);
} catch (error) {
  if (branchExists()) {
    console.log(
      `Neon branch '${branchName}' already exists in project ${projectId} (concurrent create).`,
    );
    process.exit(0);
  }
  throw error;
}

console.log(
  `Created Neon branch '${branchName}' (parent: ${parentBranch}) in project ${projectId}.`,
);
