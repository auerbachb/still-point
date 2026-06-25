#!/usr/bin/env node
/**
 * Web (Playwright) failure classifier — the web counterpart of the iOS
 * `is_retriable_failure()` shell function in `scripts/e2e/run-ios-tests.sh`.
 *
 * Given a failed Playwright attempt log, decide whether the failure looks
 * transient/infra (retriable — consume the retry budget) or carries a known
 * assertion / contract signature (non-retriable — fail the lane fast without
 * burning a retry). Aligns with the "Non-retriable failures" column in
 * docs/testing/e2e-policy.md Section 1.
 *
 * Precedence mirrors iOS exactly:
 *   1. Crash / browser-loss FIRST — a browser-process crash can surface as a
 *      failed `expect(...)`; like the iOS crash-report check it overrides any
 *      assertion-shaped line in the log, so it is evaluated before the strict
 *      assertion check. Two inputs: (a) a crash-dump directory scanned for
 *      files newer than the attempt-start sentinel (see `attemptMarker`), and
 *      (b) browser-loss signatures in the log itself.
 *   2. Non-retriable assertion / contract patterns — `expect(...)` failures
 *      (assertion mismatch AND selector-contract drift both surface this way in
 *      Playwright), snapshot/visual mismatches, and schema/data-contract errors
 *      → exit fast, do NOT consume retry budget.
 *   3. Default — everything else (network timeouts, runner disconnects, unknown
 *      crashes) is retriable and consumes the budget.
 *
 * Web intentionally diverges from iOS in one place: iOS treats timeout-shaped
 * UI waits as auto-retriable (tier 2). Web does NOT, because selector-contract
 * drift is non-retriable per policy and shows up as `expect(locator).toBeVisible()
 * failed`. Action/navigation `TimeoutError`s that are NOT expect failures still
 * fall through to the retriable default.
 *
 * Usage (CLI):
 *   node scripts/e2e/classify-web-failure.mjs <attempt-log> [attempt-marker]
 *   exit 0 => retriable, exit 1 => non-retriable (matches iOS return codes).
 *
 * Usage (module):
 *   import { classifyWebFailure } from "./classify-web-failure.mjs";
 *   const { retriable, reason } = await classifyWebFailure({ logPath, attemptMarker });
 */
import { readFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Tier 1a — browser-process loss / crash signatures (retriable, overrides
// any concurrent assertion line, same spirit as the iOS crash-report check).
const BROWSER_CRASH_PATTERNS = [
  /Target (?:page, context or browser has been closed|closed|crashed)/i,
  /Browser(?:Type|Context)?[^\n]*?(?:closed unexpectedly|has been closed|has crashed)/i,
  /\bPage crashed\b/i,
  /browserType\.launch[:!]/i,
  /Failed to launch[^\n]*?(?:browser|chromium|webkit|firefox)/i,
  /Executable doesn'?t exist/i,
  /Protocol error[^\n]*?(?:Target closed|Connection closed)/i,
];

// Tier 2 — non-retriable assertion / contract signatures. A failure matching
// any of these is a real product/test bug; fail fast without a retry.
const NON_RETRIABLE_PATTERNS = [
  // Playwright expect() matcher failures. Covers both assertion mismatches
  // (`expect(received).toBe(...)`) and selector-contract drift, which surfaces
  // as `expect(locator).toBeVisible() failed`. Requiring the trailing `failed`
  // (or the `Error: expect(` header) avoids matching the test's own source
  // lines, which Playwright echoes in its code frame.
  /Error:\s*expect(?:\.\w+)?\(/,
  /\bexpect(?:\.\w+)?\([^\n]*\)[^\n]*\bfailed\b/i,
  // Soft-assertion summary emitted by expect.soft on teardown.
  /\d+ soft assertions? failed/i,
  // Visual / snapshot baselines.
  /Screenshot comparison failed/i,
  /toMatchSnapshot|toHaveScreenshot/i,
  /A snapshot doesn'?t (?:exist|match)/i,
  // Schema / data-contract violations.
  /\bZodError\b/,
  /\b(?:Schema|Validation)Error\b/,
  /does not (?:match|conform to)[^\n]*schema/i,
];

// Tier 3 (labelling only) — known transient/infra signatures. These are
// retriable just like the default branch, but matching one yields a clearer
// reason string in logs/artifacts.
const TRANSIENT_PATTERNS = [
  /net::ERR_[A-Z_]+/,
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE)\b/,
  /socket hang up/i,
  /WebSocket (?:error|closed|connection closed)/i,
  /Timed out waiting [^\n]*web server/i,
  /Process from config\.webServer (?:was not able to start|exited)/i,
  /(?:navigation|action) timeout|Timeout \d+ms exceeded/i,
];

// Crash-dump file shapes worth treating as a browser/runner crash on Linux/CI.
const CRASH_FILE_PATTERN = /(?:\.dmp$|\.ips$|^core(?:\.\d+)?$|crash|minidump)/i;

// Playwright colorizes output (FORCE_COLOR in CI), so strip ANSI escapes before
// matching or `Error: \x1b[2mexpect(` would slip past anchored patterns.
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

// Playwright prints a source code frame for the failing test, e.g.
// `> 15 |   await expect(page.getByRole(...)).toBeVisible({`. Those echoed
// source lines must NOT be classified — the failure shape lives in the
// `Error:` lines, not in the test's own source. Drop code-frame lines (with or
// without the `>` pointer and the `^` caret line) before matching.
const CODE_FRAME_LINE = /^\s*(?:>\s*)?\d+\s*\|/;
const CARET_LINE = /^\s*\|\s*\^?\s*$/;

function normalizeLog(raw) {
  return raw
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .filter((line) => !CODE_FRAME_LINE.test(line) && !CARET_LINE.test(line))
    .join("\n");
}

function firstMatch(haystack, patterns) {
  for (const pattern of patterns) {
    const match = haystack.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Returns true if `crashDir` contains a file whose mtime is newer than the
 * attempt-start sentinel. The sentinel MUST be created before the attempt
 * starts: comparing against the tee'd attempt log is wrong because `tee` keeps
 * advancing the log's mtime until the browser exits, so a crash dump written
 * mid-run can end up "older" than the log and be missed.
 */
async function hasNewerCrashDump(crashDir, attemptMarker) {
  if (!crashDir || !attemptMarker) {
    return false;
  }
  let sinceMs;
  try {
    sinceMs = (await stat(attemptMarker)).mtimeMs;
  } catch {
    return false;
  }

  async function walk(dir, depth) {
    if (depth < 0) {
      return false;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (await walk(full, depth - 1)) {
          return true;
        }
        continue;
      }
      if (!CRASH_FILE_PATTERN.test(entry.name)) {
        continue;
      }
      try {
        if ((await stat(full)).mtimeMs > sinceMs) {
          return true;
        }
      } catch {
        // ignore unreadable entries
      }
    }
    return false;
  }

  return walk(crashDir, 4);
}

/**
 * Classify a failed Playwright attempt.
 * @param {object} opts
 * @param {string} opts.logPath          Path to the attempt log (tee'd output).
 * @param {string} [opts.attemptMarker]  Sentinel file created BEFORE the attempt.
 * @param {string} [opts.crashDir]       Dir scanned for crash dumps newer than
 *                                        the sentinel (default: $E2E_WEB_CRASH_DIR).
 * @returns {Promise<{retriable: boolean, reason: string}>}
 */
export async function classifyWebFailure({ logPath, attemptMarker, crashDir } = {}) {
  const resolvedCrashDir = crashDir ?? process.env.E2E_WEB_CRASH_DIR ?? null;

  let log = "";
  if (logPath) {
    try {
      log = normalizeLog(await readFile(logPath, "utf8"));
    } catch {
      // A missing/unreadable log is treated as infra (retriable), matching iOS
      // (`[[ -f "$log" ]] || return 0`).
      return { retriable: true, reason: "attempt log missing or unreadable (treated as infra)" };
    }
  }

  // Tier 1 — crash / browser-loss first (overrides assertion-shaped lines).
  if (await hasNewerCrashDump(resolvedCrashDir, attemptMarker)) {
    return {
      retriable: true,
      reason: `crash dump newer than attempt start found under ${resolvedCrashDir}`,
    };
  }
  const crashHit = firstMatch(log, BROWSER_CRASH_PATTERNS);
  if (crashHit) {
    return { retriable: true, reason: `browser/runner crash signature: ${crashHit.trim()}` };
  }

  // Tier 2 — non-retriable assertion / contract signatures.
  const assertionHit = firstMatch(log, NON_RETRIABLE_PATTERNS);
  if (assertionHit) {
    return { retriable: false, reason: `assertion/contract signature: ${assertionHit.trim()}` };
  }

  // Tier 3 — default retriable, with a nicer reason when a known transient
  // signature is present.
  const transientHit = firstMatch(log, TRANSIENT_PATTERNS);
  if (transientHit) {
    return { retriable: true, reason: `transient/infra signature: ${transientHit.trim()}` };
  }

  return { retriable: true, reason: "no non-retriable signature found (default: infra/unknown)" };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const logPath = process.argv[2];
  const attemptMarker = process.argv[3];
  if (!logPath) {
    console.error("usage: classify-web-failure.mjs <attempt-log> [attempt-marker]");
    process.exit(2);
  }
  const { retriable, reason } = await classifyWebFailure({ logPath, attemptMarker });
  console.log(`${retriable ? "retriable" : "non-retriable"}: ${reason}`);
  process.exit(retriable ? 0 : 1);
}
