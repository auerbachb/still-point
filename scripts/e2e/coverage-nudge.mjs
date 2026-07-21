#!/usr/bin/env node
/**
 * Advisory PR coverage nudge (#588). When a PR touches user-facing surfaces
 * without updating e2e specs, emit a notice so authors know to add/extend tests.
 * This script always exits 0 — the workflow posts a neutral advisory, not a gate.
 */

import { execFileSync } from "node:child_process";

const UI_PATH_RE =
  /^(src\/(app|components|views|features)\/|ios\/StillPointApp\/Views\/|ios\/StillPointApp\/.*View\.swift$)/;
const E2E_PATH_RE = /^(e2e\/|ios\/StillPointAppUITests\/|scripts\/e2e\/)/;

function ghLines(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function listChangedFiles() {
  const prNumber = process.env.PR_NUMBER?.trim();
  if (prNumber) {
    const files = ghLines([
      "api",
      `repos/{owner}/{repo}/pulls/${prNumber}/files`,
      "--paginate",
      "--jq",
      ".[].filename",
    ]);
    if (files && files.length > 0) return files;
  }

  const base = process.env.BASE_SHA?.trim();
  const head = process.env.HEAD_SHA?.trim();
  if (base && head) {
    return execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return null;
}

function main() {
  const files = listChangedFiles();
  if (!files) {
    console.log("::notice::Coverage nudge skipped — could not determine changed files.");
    return;
  }

  const uiFiles = files.filter((file) => UI_PATH_RE.test(file));
  const e2eFiles = files.filter((file) => E2E_PATH_RE.test(file));

  if (uiFiles.length === 0) {
    console.log("::notice::Coverage nudge: no user-facing surface changes detected.");
    return;
  }

  if (e2eFiles.length > 0) {
    console.log(
      `::notice::Coverage nudge: ${uiFiles.length} UI file(s) changed and ${e2eFiles.length} e2e file(s) updated — thanks for keeping specs in sync.`,
    );
    return;
  }

  console.log("::warning::Coverage nudge: this PR touches user-facing code without e2e spec updates.");
  console.log("Changed UI paths (sample):");
  for (const file of uiFiles.slice(0, 12)) {
    console.log(`  - ${file}`);
  }
  if (uiFiles.length > 12) {
    console.log(`  … and ${uiFiles.length - 12} more`);
  }
  console.log(
    "Consider adding or extending Playwright/XCUITest coverage. See docs/testing/e2e-coverage-matrix.md (#497).",
  );
  console.log(
    "Comprehensive e2e still runs nightly on main and gates iOS TestFlight releases — this nudge is advisory only (#588).",
  );
}

main();
