import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const REPO_ROOT = process.cwd();
const CHECKER = path.join(REPO_ROOT, "scripts", "e2e", "check-no-naked-sleep.mjs");
const TESTFLIGHT_SCRIPT = "scripts/ci/ios-testflight-build-number.mjs";

// The checker scans scripts/, this file included, so the banned calls in the
// fixtures below are spelled in pieces.
const SLEEP = "sl" + "eep";
const WAIT_FOR_TIMEOUT = "waitFor" + "Timeout";

/** The TestFlight script's back-off helper and its two call sites, indented as there. */
const BACKOFF_LINES = [
  `function ${SLEEP}(ms) {`,
  `    await ${SLEEP}(retryDelayMs * attempt);`,
  `      if (attempt < maxAttempts) await ${SLEEP}(retryDelayMs * attempt);`,
];

// The checker runs main() on load, so the tests spawn it with a chosen root as
// its cwd instead of importing it. Allow for a busy machine.
describe("check-no-naked-sleep.mjs (#920)", { timeout: 30_000 }, () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Writes each repo-relative path's lines under a new temporary root. */
  function fixtureRoot(files: Record<string, string[]>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "still-point-no-sleep-"));
    tempDirs.push(root);
    for (const [relativePath, lines] of Object.entries(files)) {
      const file = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${lines.join("\n")}\n`);
    }
    return root;
  }

  /** Runs the checker with `cwd` as the repo root. `violations` is the sorted `path:line` list. */
  function runChecker(cwd: string) {
    const result = spawnSync(process.execPath, [CHECKER], { cwd, encoding: "utf8" });
    if (result.error) throw result.error;
    const violations = result.stderr
      .split("\n")
      .map((line) => /^ {2}- (\S+:\d+): /.exec(line)?.[1])
      .filter((location): location is string => location !== undefined)
      .sort();
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, violations };
  }

  test("passes on this repository's own tree", () => {
    const result = runChecker(REPO_ROOT);
    expect(result.violations).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/across [1-9]\d* files\./);
  });

  test("exempts the TestFlight back-off and the workflow shell back-off", () => {
    const root = fixtureRoot({
      [TESTFLIGHT_SCRIPT]: BACKOFF_LINES,
      ".github/workflows/retry.yml": [`              ${SLEEP} $((attempt * 10))`],
    });
    const result = runChecker(root);
    expect(result.violations).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("across 2 files.");
  });

  test("still flags a waitForTimeout in a spec, by path and line", () => {
    const root = fixtureRoot({
      "e2e/example.spec.ts": [
        'import { test } from "@playwright/test";',
        "",
        'test("waits", async ({ page }) => {',
        `  await page.${WAIT_FOR_TIMEOUT}(1000);`,
        "});",
      ],
    });
    const result = runChecker(root);
    expect(result.status).toBe(1);
    expect(result.violations).toEqual(["e2e/example.spec.ts:4"]);
    expect(result.stderr).toContain(`e2e/example.spec.ts:4: await page.${WAIT_FOR_TIMEOUT}(1000);`);
  });

  test.each([
    "e2e/retry.spec.ts",
    // Ends with the allow-listed path, so only an exact path match rejects it.
    `e2e/${TESTFLIGHT_SCRIPT}`,
    "scripts/ci/other-provisioning.mjs",
  ])("flags the same back-off lines in %s", (relativePath) => {
    const root = fixtureRoot({ [relativePath]: BACKOFF_LINES });
    const result = runChecker(root);
    expect(result.status).toBe(1);
    expect(result.violations).toEqual([`${relativePath}:1`, `${relativePath}:2`, `${relativePath}:3`]);
  });

  test.each([
    ["a fixed delay", `    await ${SLEEP}(1000);`],
    ["a different delay", `    await ${SLEEP}(30000 * attempt);`],
    ["a second call after a back-off call", `    await ${SLEEP}(retryDelayMs * attempt); await ${SLEEP}(5000);`],
    ["a wait before a back-off call", `    await page.${WAIT_FOR_TIMEOUT}(1); await ${SLEEP}(retryDelayMs * attempt);`],
  ])("flags %s in the TestFlight script", (_case, line) => {
    const root = fixtureRoot({ [TESTFLIGHT_SCRIPT]: [...BACKOFF_LINES, line] });
    const result = runChecker(root);
    expect(result.status).toBe(1);
    expect(result.violations).toEqual([`${TESTFLIGHT_SCRIPT}:4`]);
  });
});
