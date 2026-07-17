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

function buildProtectionPayload(protection, mergedContexts) {
  const reviews = protection.required_pull_request_reviews;
  const restrictions = protection.restrictions;
  return {
    required_status_checks: {
      strict: protection.required_status_checks?.strict ?? true,
      contexts: mergedContexts,
    },
    enforce_admins: protection.enforce_admins?.enabled ?? false,
    required_pull_request_reviews: reviews
      ? {
          dismiss_stale_reviews: reviews.dismiss_stale_reviews ?? false,
          require_code_owner_reviews: reviews.require_code_owner_reviews ?? false,
          required_approving_review_count: reviews.required_approving_review_count ?? 0,
          ...(reviews.require_last_push_approval !== undefined
            ? { require_last_push_approval: reviews.require_last_push_approval }
            : {}),
          ...(reviews.bypass_pull_request_allowances !== undefined
            ? { bypass_pull_request_allowances: reviews.bypass_pull_request_allowances }
            : {}),
        }
      : null,
    restrictions: restrictions
      ? {
          users: (restrictions.users ?? []).map((user) => user.login ?? user),
          teams: (restrictions.teams ?? []).map((team) => team.slug ?? team),
          apps: (restrictions.apps ?? []).map((app) => app.slug ?? app),
        }
      : null,
  };
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
  const payload = buildProtectionPayload(protection, merged);

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

  ghApiPut(`repos/{owner}/{repo}/branches/${BRANCH}/protection`, payload);
  console.log("[branch-protection] Updated required status checks.");
}

main();
