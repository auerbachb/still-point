/**
 * Issue #733 — every test file that boots PGlite must run in the `pglite`
 * Vitest project. Anywhere else, its embedded-Postgres boot gets Vitest's
 * default 5s test / 10s hook budget and times out on a busy machine.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { PGLITE_TEST_FILES } from "./pgliteTestFiles";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// The directories `npm run test:unit` runs (`vitest run src scripts`), and the
// file names Vitest's default `include` picks up there.
const TEST_ROOTS = ["src", "scripts"];
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const IMPORTS_PGLITE =
  /(?:from\s+|import\s*\(\s*)["'](?:@electric-sql\/pglite|[^"']*\/pgliteTestDb)["']/;
// The guard evaluates two pattern shapes: `**/*<suffix>` and a literal path.
const SUFFIX_GLOB = "**/*";
const GLOB_SYNTAX = /[*?[\]{}()!]/;

function testFiles(): string[] {
  return TEST_ROOTS.flatMap((root) =>
    readdirSync(join(REPO_ROOT, root), { recursive: true, encoding: "utf8" })
      .filter((file) => TEST_FILE.test(file))
      .map((file) => join(root, file).split(sep).join("/")),
  );
}

function importsPglite(file: string): boolean {
  return IMPORTS_PGLITE.test(readFileSync(join(REPO_ROOT, file), "utf8"));
}

function suffixOf(pattern: string): string | null {
  return pattern.startsWith(SUFFIX_GLOB) ? pattern.slice(SUFFIX_GLOB.length) : null;
}

function inPgliteProject(file: string): boolean {
  return PGLITE_TEST_FILES.some((pattern) => {
    const suffix = suffixOf(pattern);
    return suffix === null ? file === pattern : file.endsWith(suffix);
  });
}

describe("pglite Vitest project routing (#733)", () => {
  test("lists only pattern shapes this guard can evaluate", () => {
    const unsupported = PGLITE_TEST_FILES.filter((pattern) =>
      GLOB_SYNTAX.test(suffixOf(pattern) ?? pattern),
    );
    expect(unsupported).toEqual([]);
  });

  test("every test file that imports PGlite runs in the pglite project", () => {
    const unrouted = testFiles().filter((file) => importsPglite(file) && !inPgliteProject(file));
    expect(unrouted).toEqual([]);
  });

  test("every listed path still exists and still imports PGlite", () => {
    const files = new Set(testFiles());
    const stale = PGLITE_TEST_FILES.filter((pattern) => suffixOf(pattern) === null).filter(
      (file) => !files.has(file) || !importsPglite(file),
    );
    expect(stale).toEqual([]);
  });
});
