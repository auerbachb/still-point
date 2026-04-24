import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET_DIRS = ["e2e", "scripts", ".github/workflows"];
const ALLOWED_SLEEP_PATTERNS = [
  /sleep\s+\$\(\(attempt \* \d+\)\)/, // bounded infra retry backoff in workflows
];

function shouldInspect(filePath) {
  return [".ts", ".tsx", ".js", ".mjs", ".swift", ".yml", ".yaml"].includes(path.extname(filePath));
}

function isAllowed(line) {
  return ALLOWED_SLEEP_PATTERNS.some((pattern) => pattern.test(line));
}

function hasNakedSleep(line, filePath) {
  const unixPath = filePath.split(path.sep).join("/");
  const isSwiftTestFile = /\/Tests\/.*Tests\.swift$/i.test(unixPath);
  const swiftSleepPattern = isSwiftTestFile ? /\bThread\.sleep\b|\bTask\.sleep\b/ : null;
  return (
    /\bwaitForTimeout\(|\bsleep\(|\bsleep\s+\d+/.test(line) ||
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
    } catch {
      // optional directory
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
    lines.forEach((line, idx) => {
      if (!hasNakedSleep(line, file)) {
        return;
      }
      if (isAllowed(line)) {
        return;
      }
      violations.push(`${path.relative(ROOT, file)}:${idx + 1}: ${line.trim()}`);
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
