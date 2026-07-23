#!/usr/bin/env node
/**
 * Sync required status checks on `main` for issue #588.
 *
 * Sets the fast PR merge gate (folds #434 unit-tests + #439 Info.plist sync +
 * #588 e2e-off-PR). Supersedes #537 (which would have required web-e2e lanes).
 *
 * Adds the target checks and removes deprecated e2e required checks if present.
 * Preserves unrelated required checks (e.g. Vercel app checks).
 *
 * Usage:
 *   node scripts/ci/sync-main-required-checks.mjs --dry-run
 *   node scripts/ci/sync-main-required-checks.mjs --apply
 *
 * Requires explicit repo-admin confirmation before --apply (see branch-protection.md).
 */

import { execFileSync } from "node:child_process";

const BRANCH = "main";

/** Fast checks that must stay required (#588, #434, #439). */
const TARGET_CHECKS = [
  "typecheck",
  "unit-tests",
  "build",
  "StillPointShared swift test",
  "Info.plist in sync with project.yml",
];

/** Deprecated e2e checks to remove when syncing (#588 supersedes #537). */
const REMOVE_CHECKS = [
  "web-e2e-smoke",
  "web-e2e-critical",
  "e2e-policy",
];

function ghJson(args) {
  const out = execFileSync("gh", args, { encoding: "utf8" });
  return JSON.parse(out);
}

function ghApiPatch(path, body) {
  execFileSync("gh", ["api", "-X", "PATCH", path, "--input", "-"], {
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

function mergeChecks(existing, target, remove) {
  const filtered = existing.filter((ctx) => !remove.includes(ctx));
  return [...new Set([...filtered, ...target])].sort((a, b) => a.localeCompare(b));
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
  const merged = mergeChecks(existing, TARGET_CHECKS, REMOVE_CHECKS);
  const payload = buildRequiredStatusChecksPayload(protection, merged);

  console.log(`Branch: ${BRANCH}`);
  console.log(`Existing required checks (${existing.length}):`);
  for (const ctx of existing) console.log(`  - ${ctx}`);
  console.log(`Target union (${merged.length}):`);
  for (const ctx of merged) console.log(`  - ${ctx}`);

  const removed = existing.filter((ctx) => REMOVE_CHECKS.includes(ctx));
  if (removed.length > 0) {
    console.log("Will remove (deprecated e2e gates — #588):");
    for (const ctx of removed) console.log(`  - ${ctx}`);
  }

  const added = merged.filter((ctx) => !existing.includes(ctx));
  if (added.length === 0 && removed.length === 0) {
    console.log("[branch-protection] Nothing to change — already in sync.");
    return;
  }

  if (added.length > 0) {
    console.log("Will add:");
    for (const ctx of added) console.log(`  + ${ctx}`);
  }

  if (dryRun) {
    console.log("[branch-protection] Dry run — re-run with --apply to write.");
    return;
  }

  ghApiPatch(
    `repos/{owner}/{repo}/branches/${BRANCH}/protection/required_status_checks`,
    payload,
  );
  console.log("[branch-protection] Updated required status checks.");
}

main();
