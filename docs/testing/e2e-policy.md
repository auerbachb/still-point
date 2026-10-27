# E2E Cross-Cutting Policy (Issue #194)

This policy defines how web and iOS E2E runs are executed, triaged, and gated in CI.

It applies to Issue #194 and is inherited by child issues:

- [#191](https://github.com/auerbachb/still-point/issues/191)
- [#192](https://github.com/auerbachb/still-point/issues/192)
- [#193](https://github.com/auerbachb/still-point/issues/193)
- [#497](https://github.com/auerbachb/still-point/issues/497) — journey coverage matrix and gap-fill (supersedes [#190](https://github.com/auerbachb/still-point/issues/190) / [#152](https://github.com/auerbachb/still-point/issues/152) tracking)

Journey × platform coverage, P0/P1/P2 tiers, and justified exclusions (OAuth, breath counting): [`e2e-coverage-matrix.md`](./e2e-coverage-matrix.md).

How the scripts enforce this policy (retry classifier signatures, sleep-check matching): [`e2e-policy-enforcement.md`](./e2e-policy-enforcement.md). Section numbers there match the sections here.

## 1) Retry policy and non-retriable failures

Retries are lane-specific and intentionally low to avoid masking real regressions.

| Job / lane | Max retries | Non-retriable failures | Retriable failures |
|---|---:|---|---|
| `web-e2e-smoke` | 1 | Assertion mismatches (`expect(...)` failures), selector contract drift, schema/data contract violations | Browser boot issues, network timeouts, runner disconnects |
| `web-e2e-critical` | 2 | Same as smoke (functional assertion failures are never auto-excused) | Same infra/transient failures as smoke |
| `ios-e2e-smoke` | 1 | XCTest assertion failure that is not a timeout-shaped UI wait (no concurrent simulator-side crash report) | Simulator boot flake, xcodebuild infra instability, simulator-side app crashes (`*StillPoint*.ips`), timeout-shaped UI waits (e.g. `waitForExistence` "did not appear") |
| `ios-e2e-critical` | 1 | XCTest assertion failure that is not a timeout-shaped UI wait (no concurrent simulator-side crash report) | Simulator/device provisioning infra errors, simulator-side app crashes (`*StillPoint*.ips`), timeout-shaped UI waits (e.g. `waitForExistence` "did not appear") |

Rules:

1. Retry is only for transient infrastructure instability.
2. If a failure reproduces consistently on rerun, classify it as product/test debt, not infra.
3. CI should preserve first-failure artifacts even when retries eventually pass.

**Enforcement:** each lane's runner classifies every failed attempt before spending a retry — `scripts/e2e/run-ios-tests.sh` for iOS, `scripts/e2e/run-playwright-lane.mjs` + `scripts/e2e/classify-web-failure.mjs` for web. Both check a crash first (a crash overrides any concurrent assertion line and is retriable), then known non-retriable assertion/contract shapes (fail the lane fast), then retry everything else up to the table value. The one deliberate difference: iOS retries timeout-shaped UI waits; web does not, because selector-contract drift surfaces as an `expect(...)` failure. Precedence and the exact signatures each tier matches: [`e2e-policy-enforcement.md` §1](./e2e-policy-enforcement.md#1-retry-classifiers-e2e-policymd-1).

## 2) Test data isolation policy

Use isolated users for every run:

- `scripts/seed.ts` supports `E2E_RUN_ID`; each fixture email/username becomes run-unique.
- Email format: `seed_localpart+<run-id>@stillpoint.local`.
- Username format: `<base_username>_<run-id>`.

Required approach:

1. Set `E2E_RUN_ID` in CI/job context (`${{ github.run_id }}` recommended).
2. Seed with `SEED_CONFIRM=still-point-nonprod npm run db:seed`.
3. Preferred cleanup strategy: disposable non-production Neon branch/org per run.
4. Acceptable fallback: reseed with same `E2E_RUN_ID` to replace prior fixture rows idempotently.

Never point seed or E2E users at production data.

## 3) Deterministic waits policy

Naked sleeps are banned for test synchronization:

- disallowed: `waitForTimeout(...)`, `sleep(...)`, `Thread.sleep`, `Task.sleep` in test code/workflows
- allowed exception: bounded infra backoff in non-test provisioning steps (documented inline), in exactly two forms:
  - a workflow shell retry written as `sleep $((attempt * N))`, alone on its line, in a file under `.github/workflows/` only (Issue #935).
  - named lines of a non-test provisioning script, allow-listed by path and exact line text in `ALLOWED_SLEEP_LINES_BY_PATH` (`scripts/e2e/check-no-naked-sleep.mjs`), each with a comment saying what the back-off retries (Issue #920). Never add an entry for a file under `e2e/` or for any other test code.

  How the checker matches these, and the current allow-list entries: [`e2e-policy-enforcement.md` §3](./e2e-policy-enforcement.md#3-naked-sleep-check-exemptions-e2e-policymd-3).

Enforcement:

- `npm run e2e:policy:no-sleep`
- `npm run test:unit` runs `scripts/e2e/check-no-naked-sleep.test.ts`, which runs the check over the repository on every PR and pins the scope of the exception above
- Playwright tests must rely on role/locator contracts and assertion-driven waits
- iOS tests must use XCTest expectations/predicate waits and accessibility identifiers

Role/locator contract source of truth: [`e2e-coverage-matrix.md`](./e2e-coverage-matrix.md) (Issue #497); historical tracking in [#152](https://github.com/auerbachb/still-point/issues/152).

## 4) Secrets and credentials policy

1. E2E credentials must come from CI/local env vars only.
2. No real user credentials in repo (including `.env.example`).
3. `.env.example` may only show placeholders (`test+<run-id>@stillpoint.local`, etc.).
4. Never use `@still-point.me` user credentials for automated testing.

Checks:

- `npm run e2e:policy:secrets`
- `scripts/e2e/run-ios-tests.sh` rejects production-looking user emails when credentials are provided.
- For credentialed flows, CI jobs should provide `E2E_TEST_USER_EMAIL` and `E2E_TEST_USER_PASSWORD` via secrets.
- Mobile web Playwright against a real backend: use `E2E_WEB_EMAIL` / `E2E_WEB_PASSWORD` plus `POSTGRES_URL` (non-production Neon only) and `E2E_WEB_SETUP_USER=true` so `e2e/global-setup.ts` upserts the fixture user before tests (`e2e/README.md`). When those values are missing in CI (for example fork PRs without secrets), setup is skipped and tests continue with mocked APIs until real-auth coverage is added.

## 5) Environment guardrails

E2E must fail fast if target appears production:

- `npm run e2e:guard` blocks:
  - `still-point.me`, `www.still-point.me`
  - `*.vercel.app`
- `scripts/e2e/run-ios-tests.sh` blocks:
  - `E2E_ENV=prod`
  - `E2E_BASE_URL` containing `still-point.me`

These checks run before any lane starts.

## 6) Failure artifacts (required)

### Web

Always collect on failure:

- Playwright trace (`retain-on-failure`)
- screenshot (`only-on-failure`)
- video (`retain-on-failure`)

Workflow uploads:

- `artifacts/e2e/web/**`
- `playwright-report/**`
- `test-results/**`

### iOS

When available, collect:

- xcresult bundle per attempt
- xcodebuild lane log
- screenshots/log bundle exported from xcresult tools (if configured)

Workflow uploads:

- `artifacts/e2e/ios/**`

If a repository does not yet include `ios/StillPointUITests`, iOS lanes may skip while still uploading status/perf artifacts.

## 7) Flake triage rubric

Use this rubric for any flaky failure:

1. **Classify**
   - `infra-flake`: runner/network/simulator instability
   - `test-flake`: brittle selector/timing contract
   - `product-flake`: nondeterministic app behavior
2. **Quarantine criteria**
   - same spec flakes >= 2 times in 7 days OR
   - single flake blocks merge on critical lane
3. **Owner**
   - lane owner is the suite maintainer (`web` or `ios`)
4. **SLA**
   - quarantine issue opened same day
   - fix merged within 3 business days
5. **Exit**
   - remove quarantine only after 2 consecutive clean CI passes

## 8) Tagging and lane selection strategy

Supported tags:

- `@smoke`: fastest confidence checks (merge-blocking)
- `@critical`: high-risk user journeys (merge-blocking)
- `@visual`: visual assertions/snapshots (non-blocking in v1)
- `@perf`: perf metric collection hooks

Lane wiring:

- `npm run e2e:web:smoke` => `--grep @smoke`
- `npm run e2e:web:critical` => `--grep @critical`
- `npm run e2e:ios:smoke` => iOS smoke test target
- `npm run e2e:ios:critical` => iOS critical test target

## 9) Visual checks scope (v1 decision)

v1 scope decision:

- **In scope**:
  - targeted rendering assertions (key CTA visibility and core auth affordances)
  - optional artifact screenshots for manual regression review
- **Out of scope for v1**:
  - full-page snapshot baselines as merge blockers
  - pixel-diff gating in CI

Snapshot tests are explicitly optional in v1; revisit after flake rate stabilizes.

## 10) Performance hooks (lightweight per platform)

At least one metric per platform is always reported.

- Web: `firstResponseMs` via `npm run e2e:web:perf` (`E2E_WEB_FIRST_RESPONSE_MS`)
- iOS: `app_boot_seconds` via `npm run e2e:ios:perf` (`IOS_E2E_APP_BOOT_SECONDS`)

Fail thresholds are optional:

- Web enforce toggle: `E2E_WEB_PERF_ENFORCE=true`
- iOS enforce toggle: `IOS_E2E_FAIL_ON_PERF=true`

Default behavior: report-only, store JSON artifacts.

### iOS cold-start auth-check bound

`StillPointAppUITests` carries an in-test guard (`coldStartMaxMs`) on the
app-reported cold-start auth-check latency (`coldStartAuthCheckMs`), distinct
from the `app_boot_seconds` metric above and from XCTest launch overhead.

- **Bound:** 12000ms. Raised from 5000ms in [#334](https://github.com/auerbachb/still-point/issues/334) and from 8000ms when macos-26 / iOS-26 CI simulators still reported auth-check latency above 8000ms under contention (infra-shaped flakes, not auth regressions).
- **Scope:** the assertion runs only on cold-start paths that boot to the auth screen (`seedAuthenticated: false`). Authenticated boots (`seedAuthenticated: true`) and seeded relaunches pass `assertColdStart: false`, since the auth-check there is incidental to what the test asserts (home/settings/session behavior).
- **Rationale:** keeping the guard on the unauthenticated cold-start path preserves a meaningful latency check where it is the focus, while removing it from authenticated boots eliminates the intermittent failures flagged in #334 (Option 3: skip where cold-start is not the focus).

## 11) PR merge gating policy

As of [#588](https://github.com/auerbachb/still-point/issues/588) (SkinGod model), **comprehensive e2e does not gate PR merges**. Required lanes are the fast checks documented in [branch-protection.md](./branch-protection.md):

1. `typecheck`
2. `unit-tests` (#434)
3. `build` (clean Next build + design-token parity)
4. `StillPointShared swift test` (#463 no-op when unchanged)
5. `Info.plist in sync with project.yml` (#439 — always-run workflow, #588)

PR advisory (non-blocking):

- `pr-e2e-smoke (advisory)` — fast web smoke ([e2e-smoke.yml](../../.github/workflows/e2e-smoke.yml))
- `e2e coverage nudge (advisory)` — neutral reminder when UI changes lack spec updates

Issue [#537](https://github.com/auerbachb/still-point/issues/537) (require `web-e2e-smoke` / `web-e2e-critical` on PRs) is **superseded** by #588. Strategy overview: [e2e-strategy.md](./e2e-strategy.md).

### Release-time gating (mobile web + native iOS TestFlight)

As of [#494](https://github.com/auerbachb/still-point/issues/494) (mirroring [auerbachb/skingod#1402](https://github.com/auerbachb/skingod/issues/1402)), the mobile-web Playwright suite (`e2e-mobile.yml`, the 3-project cross-browser matrix) no longer runs on `pull_request` — it was the slowest, flakiest per-PR check, had no path filter, and blocked every PR regardless of relevance. It is now a reusable workflow (`workflow_call` + `workflow_dispatch` only) that runs:

- as the first job of [`ios-testflight-auto.yml`](../../.github/workflows/ios-testflight-auto.yml), the automatic release path that every merge to `main` changing iOS app code triggers (#707). The step that claims the build number and pushes its tag only proceeds when **both** mobile-web and native iOS e2e succeed (#588);
- on demand via `gh workflow run e2e-mobile.yml -f ref=<ref>` for ad-hoc verification.

[`ios-testflight.yml`](../../.github/workflows/ios-testflight.yml) (the manual `ios-v*-build*` tag push, a break-glass escape hatch for shipping when e2e infra itself is down) intentionally does **not** call this gate.

As of [#588](https://github.com/auerbachb/still-point/issues/588), native iOS e2e (`e2e-ios.yml` — XCTest smoke/critical) also moved off `pull_request` and gates the same automatic TestFlight path alongside mobile-web e2e. Info.plist sync moved to [`infoplist-sync.yml`](../../.github/workflows/infoplist-sync.yml) as a fast required PR check.

### Nightly web e2e (#588)

Web has no discrete "build" step (production deploys on every merge to `main`), so comprehensive web e2e runs on a **nightly schedule** via [`e2e-web-nightly.yml`](../../.github/workflows/e2e-web-nightly.yml) (full smoke + critical + policy lanes on `main`) plus `workflow_dispatch`. This keeps [#497](./e2e-coverage-matrix.md) P0 coverage exercised without blocking PR merges.

## 12) Local runbook (single command per platform)

Prereqs:

- non-production env vars populated
- test credentials exported from local secret store
- database schema pushed and seeded

Commands:

```bash
# policy checks + non-prod guard
npm run e2e:policy

# web smoke / critical
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e:web:smoke
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e:web:critical

# iOS smoke / critical
E2E_BASE_URL=http://127.0.0.1:3000 E2E_TEST_USER_EMAIL=test+local@stillpoint.local E2E_TEST_USER_PASSWORD=changeme npm run e2e:ios:smoke
E2E_BASE_URL=http://127.0.0.1:3000 E2E_TEST_USER_EMAIL=test+local@stillpoint.local E2E_TEST_USER_PASSWORD=changeme npm run e2e:ios:critical
```

Seed/reset:

```bash
SEED_CONFIRM=still-point-nonprod E2E_RUN_ID=local npm run db:seed
```

## 13) Post-failure reproducibility

To rerun the exact failed spec:

### Web

1. Copy the failing spec path + title from CI logs.
2. Re-run with line/title filtering:

```bash
E2E_BASE_URL=http://127.0.0.1:3000 npx playwright test e2e/web/<spec>.spec.ts -g "<test title>"
```

3. Open trace from `test-results/**/trace.zip` using:

```bash
npx playwright show-trace test-results/<path>/trace.zip
```

### iOS

1. Copy failing test identifier (`ClassName/testMethod`) from CI log.
2. Re-run with matching destination:

```bash
xcodebuild test -project ios/StillPoint.xcodeproj -scheme StillPoint -testPlan StillPointE2E -destination 'platform=iOS Simulator,name=iPhone 16,OS=latest' -only-testing:StillPointUITests/ClassName/testMethod
```

3. Inspect artifact bundle:

```bash
xcrun xcresulttool get --path artifacts/e2e/ios/<lane>-attempt-<n>.xcresult --format json
```
