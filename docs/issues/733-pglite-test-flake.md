# PGlite-backed tests timing out in `npm run test:unit`

**Issue:** #733
**Status:** Fixed. PGlite-backed files now run as their own Vitest project (`pglite` in `vitest.config.ts`).
**Date investigated:** 2026-10-26
**Related:** PR #727, where the flake was first noticed

## Correction: there is no remote database

PR #727's notes put the flake down to tests "hitting a shared remote DB and contending under the parallel runner." **That is wrong.**

- `src/lib/testing/pgliteTestDb.ts` calls `new PGlite()`, which starts Postgres compiled to WebAssembly, **in-process and in-memory**.
- There is no remote database, no `POSTGRES_URL`, and no shared server. No two test files share any data.
- Each test file boots its own instance. That happens directly with `new PGlite()`, or through `getTestDb()`, which boots one instance per file and runs drizzle-kit's `pushSchema` against it.

## What actually fails

On 2026-10-26, six full `npm run test:unit` runs on the unchanged tree **all failed**. The machine was a 16-core Mac with load average 53–191, from other agents' test runs. Every failure came from the same four files, with a different subset of their tests failing each run (5–7 tests per run):

- `scripts/apply-migrations.test.ts`
- `src/db/buddy-one-host-index.integration.test.ts`
- `src/db/consent-events-674.integration.test.ts`
- `src/db/schema.recovery-constraint.test.ts`

Every failure was a timeout: `Error: Test timed out in 5000ms.`, or, for the first `beforeEach` in `buddy-one-host-index`, `Error: Hook timed out in 10000ms.` No schema push errored and no assertion failed.

CI hits it too. Unit-tests run 39548366161 failed on 2026-10-21, on a Dependabot branch with no app changes: `consent-events-674 › backfills a granted event and removes it when the user is deleted` ran for 5074 ms and timed out.

## Why those four files

Those four files are the PGlite-backed tests whose Postgres **boot runs inside a timed test or hook**:

- `new PGlite()` in a test body: `consent-events-674`, `apply-migrations`, and the migration-artifact tests in `buddy-one-host-index`.
- The first `getTestDb()` call (boot, plus importing `drizzle-kit/api`, plus `pushSchema`) inside a test or `beforeEach`: `schema.recovery-constraint` and `buddy-one-host-index`.

The other 20 PGlite-backed files never failed: the 19 route-level integration tests and `oauth-user-resolution`. They boot through `vi.mock("@/db", async () => ({ db: await getTestDb() }))`, which runs while the module is imported, and Vitest does not time imports. Their slowest test across all six baseline runs was 459 ms.

A single boot alone costs seconds of CPU. On the loaded machine, in one process with nothing else from the suite running, a cold `new PGlite()` took 1.1–3.6 s. A boot plus schema push took 3.5–5.0 s, already at the 5 s budget. With the suite's 15 default workers each booting their own Postgres alongside, the boots slow down well past that budget.

## Measurements

Every row is a full `npm run test:unit` run on the same machine. A "boot test" is a test in the four files above. Durations come from Vitest's JSON reporter.

| Configuration | Load avg | Runs failed | Median boot test | Slowest boot test | Wall-clock |
|---|---|---|---|---|---|
| Unchanged (15 workers) | 53–191 | **6 / 6** | 3.1–4.6 s | 7.2–13.1 s ¹ | 28–35 s |
| Unchanged, `--maxWorkers=4` | 115–238 | **2 / 3** | 1.0–2.5 s | 3.2–18.9 s | 29–157 s |
| Unchanged, `--maxWorkers=1` | 118–197 | 0 / 2 | 0.8 s | 1.9–2.2 s | 89–196 s |
| Own project, 60 s budgets, no worker cap | 207–318 | 0 / 3 | 5.0–6.1 s | 16.0–17.1 s | 51–53 s |
| Own project, 4-worker cap, default budgets | 277–320 | **1 / 3** ² | 1.2–4.5 s | 3.7–8.5 s | 48–82 s |
| Own project, 4-worker cap + 60 s budgets | 219–249 | 0 / 3 | 1.5–4.3 s | 3.1–10.5 s | 31–68 s |

¹ These durations are cut off by the timeout. The reported time can run well past 5 s because PGlite runs Postgres's start-up as synchronous WebAssembly on the test's own thread. The timeout timer can only fire once that work yields, and a starved CPU delays it further.

² That failing run included a pure unit test (`src/app/api/auth/apple/notifications/route.test.ts`), at load average ~320: about 20 runnable threads per core. At that load no 5 s budget holds.

The numbers show two things:

- **The suite's own parallelism is the main amplifier.** The median boot test takes 0.8 s with one worker, 1–2.5 s with four, and 3–6 s with fifteen.
- **Fewer workers alone do not fix it.** With four workers, two of three runs still failed. Only one worker passed reliably, and it made the suite roughly 3–6× slower (89–196 s against 28–35 s). Other load on the machine is outside the suite's control, so only a realistic time budget makes the boots safe.

## The fix

`vitest.config.ts` defines two projects. Both use `extends: true`, so they share the alias, the JSX runtime, `environment: "node"` and the `**/.claude/**` exclude:

- **`unit`**: every test file except the PGlite-backed ones, with Vitest's defaults.
- **`pglite`**: the files listed in `src/lib/testing/pgliteTestFiles.ts`. That list is `**/*.integration.test.ts` plus the three PGlite-backed files outside that naming convention. The project has:
  - 60 s test and hook timeouts. That is room for a cold boot on a loaded machine (the slowest boot test measured was 17 s, with no worker cap), and a hung test still fails.
  - at most 4 workers, and never more than Vitest's default of cores − 1. The cap roughly halves boot latency compared with no cap (worst case 10.5 s instead of 17 s).
  - `sequence.groupOrder: 1`. Vitest 4 rejects projects that differ in `maxWorkers` but share a `groupOrder`, and it runs the groups in turn. The `pglite` group runs after `unit`.

`npm run test:unit` and the CI workflow are unchanged. One command still runs every file: `vitest list --filesOnly` reports the same set as before the split (plus the new guard test), now divided into `unit` and `pglite`. To run only one side, use `npm run test:unit -- --project unit` or `npm run test:unit -- --project pglite`.

`src/lib/testing/pgliteTestFiles.test.ts` keeps the routing complete:

- It fails if a test file that imports `@electric-sql/pglite` or `pgliteTestDb` is not routed to `pglite`.
- It fails if a listed path no longer exists or no longer imports PGlite.

**Adding a PGlite-backed test:** name it `*.integration.test.ts`. If you can't, add its path to `PGLITE_TEST_FILES`. The guard test tells you if you forget.

## After the fix

On the same machine, **8 of 8** full `npm run test:unit` runs passed (999 tests each), at load averages of 123–420:

- **Boot tests:** median 0.9–2.1 s, slowest 1.9–6.4 s, which is well inside the 60 s budget.
- **`unit` project:** its slowest test was 3.5 s.
- **Wall-clock:** 22–69 s per run, depending on the load at the time.

Three more pairs ran back to back, old config then new, at load averages of 370–410:

| Config | Runs failed | Wall-clock |
|---|---|---|
| Old | 3 of 3 | 19–31 s |
| New | 0 of 3 | 22–46 s |

So the new config costs about 10 s on a heavily loaded machine. The `pglite` group can no longer overlap the `unit` group, and each boot now gets the time it needs rather than failing at 5 s.
