import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["e2e", "scripts", ".github/workflows"];
const ALLOWED_SLEEP_PATTERNS = [
  /sleep\s+\$\(\(attempt \* \d+\)\)/, // bounded infra retry backoff in workflows
];

// Bounded infra retry back-off in non-test provisioning scripts
// (docs/testing/e2e-policy.md §3), keyed by exact repo-relative path. Each
// pattern matches a whole trimmed line by its text, not its number, so any
// other sleep in the file still fails. Never list test code.
const ALLOWED_SLEEP_LINES_BY_PATH = new Map([
  [
    // git ls-remote / tag-push retry back-off when claiming a TestFlight build number (#920)
    "scripts/ci/ios-testflight-build-number.mjs",
    [
      /^function sleep\(ms\) \{$/, // the back-off helper
      /^(?:if \(attempt < maxAttempts\) )?await sleep\(retryDelayMs \* attempt\);$/, // its two call sites
    ],
  ],
]);

function shouldInspect(filePath) {
  return [".ts", ".tsx", ".js", ".mjs", ".swift", ".yml", ".yaml"].includes(path.extname(filePath));
}

function isAllowed(line, relativePath) {
  if (ALLOWED_SLEEP_PATTERNS.some((pattern) => pattern.test(line))) {
    return true;
  }
  const allowedLines = ALLOWED_SLEEP_LINES_BY_PATH.get(relativePath) ?? [];
  return allowedLines.some((pattern) => pattern.test(line.trim()));
}

function hasNakedSleep(line, filePath) {
  const unixPath = filePath.split(path.sep).join("/");
  const isSwiftTestFile =
    unixPath.endsWith(".swift") &&
    /(?:^|\/)(?:[^/]*Tests|[^/]*UITests)(?:\/|$)/i.test(unixPath);
  const swiftSleepPattern = isSwiftTestFile ? /\bThread\.sleep\b|\bTask\.sleep\b/ : null;
  const shellSleepPattern =
    /\bsleep\s*(?:\(|\$\(\(|\$[A-Za-z_][A-Za-z0-9_]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d+(?:\.\d+)?\b)/;
  return (
    /\bwaitForTimeout\(/.test(line) ||
    shellSleepPattern.test(line) ||
    (swiftSleepPattern ? swiftSleepPattern.test(line) : false)
  );
}

async function walk(dirPath, collector) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "build", "dist"].includes(entry.name)) {
        continue;
      }
      await walk(fullPath, collector);
      continue;
    }
    if (shouldInspect(fullPath)) {
      collector.push(fullPath);
    }
  }
}

async function gatherFiles() {
  const files = [];
  for (const dir of TARGET_DIRS) {
    const full = path.join(ROOT, dir);
    try {
      await walk(full, files);
    } catch (error) {
      // Optional directory may be absent in some repositories.
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return files;
}

async function main() {
  const files = await gatherFiles();
  const violations = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const lines = content.split("\n");
    const relativePath = path.relative(ROOT, file).split(path.sep).join("/");
    lines.forEach((line, idx) => {
      if (!hasNakedSleep(line, file)) {
        return;
      }
      if (isAllowed(line, relativePath)) {
        return;
      }
      violations.push(`${relativePath}:${idx + 1}: ${line.trim()}`);
    });
  }

  if (violations.length > 0) {
    console.error("Found non-deterministic sleep usage. Replace with locator or expectation contracts:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }

  console.log(`No naked sleep/waitForTimeout usage found across ${files.length} files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
