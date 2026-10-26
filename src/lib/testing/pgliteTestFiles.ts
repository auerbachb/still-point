/**
 * Test files that boot an embedded Postgres (PGlite), either directly or
 * through `getTestDb()` in `./pgliteTestDb`. `vitest.config.ts` runs them as the
 * `pglite` project, with fewer workers and timeouts sized for a cold boot. A
 * boot plus schema push costs seconds of CPU, and when it runs inside a test or
 * hook on a busy machine it outruns Vitest's default 5s test / 10s hook budget
 * (#733, docs/issues/733-pglite-test-flake.md).
 *
 * Name a new PGlite-backed test `*.integration.test.ts` and it is routed here
 * automatically; list any other one explicitly. `pgliteTestFiles.test.ts` fails
 * when a PGlite-backed test file is missing from this list.
 */
export const PGLITE_TEST_FILES = [
  "**/*.integration.test.ts",
  "scripts/apply-migrations.test.ts",
  "src/db/schema.recovery-constraint.test.ts",
  "src/lib/oauth-user-resolution.test.ts",
];
