#!/usr/bin/env node
/**
 * Sync required status checks on `main` for issue #537.
 *
 * Adds `build`, `web-e2e-smoke`, and `web-e2e-critical` alongside the existing
 * required checks (`typecheck`, `StillPointShared swift test`). Does not remove
 * checks already configured unless they are superseded by this script's target
 * list (the script unions current + target).
 *
 * Usage:
 *   node scripts/ci/sync-main-required-checks.mjs --dry-run
 *   node scripts/ci/sync-main-required-checks.mjs --apply
 */

import { execFileSync } from "node:child_process";

const BRANCH = "main";

/** Checks that must stay required (existing + #537). */
const TARGET_CHECKS = [
  "typecheck",
  "StillPointShared swift test",
  "build",
  "web-e2e-smoke",
  "web-e2e-critical",
];

function ghJson(args) {
  const out = execFileSync("gh", args, { encoding: "utf8" });
  return JSON.parse(out);
}

function ghApiPut(path, body) {
  execFileSync("gh", ["api", "-X", "PUT", path, "--input", "-"], {
    input: JSON.stringify(body),
    stdio: ["pipe", "inherit", "inherit"],
  });
}

function mergeRequiredStatusChecks(protection, mergedContexts) {
  const existing = protection.required_status_checks ?? {};
  const existingChecks = existing.checks ?? [];
  const checksByContext = new Map();

  for (const check of existingChecks) {
    if (check?.context) {
      checksByContext.set(check.context, check);
    }
  }

  for (const context of mergedContexts) {
    if (!checksByContext.has(context)) {
      checksByContext.set(context, { context });
    }
  }

  const mergedChecks = mergedContexts.map((context) => checksByContext.get(context));

  return {
    strict: existing.strict ?? true,
    contexts: mergedContexts,
    ...(existingChecks.length > 0 || mergedChecks.length > 0
      ? { checks: mergedChecks }
      : {}),
  };
}

function buildRequiredStatusChecksPayload(protection, mergedContexts) {
  return mergeRequiredStatusChecks(protection, mergedContexts);
}

function mergeChecks(existing, target) {
  return [...new Set([...existing, ...target])].sort((a, b) => a.localeCompare(b));
}

function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run") || !apply;

  if (!dryRun && !apply) {
    console.error("Pass --dry-run (default) or --apply.");
    process.exit(2);
  }

  let protection;
  try {
    protection = ghJson(["api", `repos/{owner}/{repo}/branches/${BRANCH}/protection`]);
  } catch (err) {
    console.error(
      `[branch-protection] Could not read protection for ${BRANCH}. ` +
        "Ensure gh is authenticated with admin access.",
    );
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const existing = protection.required_status_checks?.contexts ?? [];
  const merged = mergeChecks(existing, TARGET_CHECKS);
  const payload = buildRequiredStatusChecksPayload(protection, merged);

  console.log(`Branch: ${BRANCH}`);
  console.log(`Existing required checks (${existing.length}):`);
  for (const ctx of existing) console.log(`  - ${ctx}`);
  console.log(`Target union (${merged.length}):`);
  for (const ctx of merged) console.log(`  - ${ctx}`);

  const added = merged.filter((ctx) => !existing.includes(ctx));
  if (added.length === 0) {
    console.log("[branch-protection] Nothing to add — already in sync.");
    return;
  }

  console.log("Will add:");
  for (const ctx of added) console.log(`  + ${ctx}`);

  if (dryRun) {
    console.log("[branch-protection] Dry run — re-run with --apply to write.");
    return;
  }

  ghApiPut(
    `repos/{owner}/{repo}/branches/${BRANCH}/protection/required_status_checks`,
    payload,
  );
  console.log("[branch-protection] Updated required status checks.");
}

main();
