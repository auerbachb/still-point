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

function ghApi(method, path, body) {
  const args = ["api", "-X", method, path, "-H", "Accept: application/vnd.github+json"];
  if (body !== undefined) {
    args.push("-f", `required_status_checks[strict]=${body.required_status_checks.strict}`);
    for (const ctx of body.required_status_checks.contexts) {
      args.push("-f", `required_status_checks[contexts][]=${ctx}`);
    }
    args.push("-f", `enforce_admins=${body.enforce_admins}`);
    args.push("-f", `required_pull_request_reviews[required_approving_review_count]=${body.required_pull_request_reviews.required_approving_review_count}`);
    args.push("-f", `restrictions=`);
  }
  execFileSync("gh", args, { stdio: "inherit" });
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
  const payload = {
    required_status_checks: {
      strict: protection.required_status_checks?.strict ?? true,
      contexts: merged,
    },
    enforce_admins: protection.enforce_admins?.enabled ?? false,
    required_pull_request_reviews: {
      required_approving_review_count:
        protection.required_pull_request_reviews?.required_approving_review_count ?? 0,
    },
  };

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

  ghApi("PUT", `repos/{owner}/{repo}/branches/${BRANCH}/protection`, payload);
  console.log("[branch-protection] Updated required status checks.");
}

main();
