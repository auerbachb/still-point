# E2E Policy Enforcement Mechanics

How the scripts enforce the rules in [`e2e-policy.md`](./e2e-policy.md). The policy doc says **what** is allowed; this doc says **how** the checks decide. Classifier signatures and sleep-check matching rules change far more often than the policy itself, so they live here (Issue #1023).

Keep this doc in sync with the scripts it describes. When a script and this doc disagree, the script is the behavior and this doc is the bug.

## 1) Retry classifiers (`e2e-policy.md` §1)

The lane table and retry rules are in [`e2e-policy.md` §1](./e2e-policy.md#1-retry-policy-and-non-retriable-failures). Both platforms decide per failed attempt whether to consume a retry.

### iOS lanes

`scripts/e2e/run-ios-tests.sh` runs a 4-tier classifier on each failed attempt:

1. **Crash check first** — if a `*StillPoint*` diagnostic report under `~/Library/Logs/DiagnosticReports/` was written after the attempt-start sentinel (`<lane>-attempt-N.start`), the failure is treated as infra and consumes a retry, **regardless of any concurrent assertion-shape line in the log**. This catches macos-26 simulator XPC faults that surface as timeout-shaped assertions like `XCTAssertTrue failed - Session screen did not appear after Begin tap` but are actually launchd/sim-level crashes.
2. **Timeout-shaped UI wait second** — if no crash report is correlated, treat the failure as retriable when the log contains any of:
    - `XCTAssertTrue failed - <msg>` where `<msg>` matches `did not appear / never appear(ed) / did not exist / does not exist / should be visible / should appear / should exist / not found / never became / did not become / did not show` (case-insensitive — typical `waitForExistence(timeout:)` shape).
    - `Asynchronous wait failed: Exceeded timeout` (XCTestExpectation/`wait(for:)` predicate-value waits, e.g. `Expect predicate value == "visible" for object "session.secondaryChromeMarker"`).
    - `Failed to set device orientation:` (simulator automation stalls in `setUpWithError()` before the app launches).
    - `Timed out while acquiring background assertion` (XCTest could not take a background assertion on the app; surfaces as a method-level error frame; retried only when the log has no `XCTAssert* failed` line, so a real assertion failure elsewhere in the lane still fails fast — issue #955, run 40453121968).
    - `Timed out while evaluating UI query` or `Timed out waiting for` (XCUITest query/wait timeouts that surface as method-level error frames without `XCTAssert*` lines — e.g. `testLaunchLoginCompleteSessionAndHistoryPersistence` smoke flake, issue #496).
   These are UI timing flakes (mocked-API stalls, animation handoff delays, focus timing, simulator orientation confirmation, XCUITest query stalls) that don't always trigger an `.ips` but reproduce inconsistently across attempts.
3. **Strict assertion check third** — for value assertions (`XCTAssertEqual`, `XCTAssertNotNil`, `XCTAssertGreaterThan`, etc.) and any `XCTAssertTrue` whose message does NOT match the timeout indicators above, the script exits without consuming the retry budget. Method-level frames like `error: -[<Module.>?<TestClass> <testMethod>]` are also non-retriable.
4. **Default** — any other failure (infra/transient/unknown) consumes retries up to the table value.

Note: detecting "same stack across attempts" (a stricter, repeated-crash signal) is intentionally out-of-scope — it would require diffing per-attempt diagnostic reports across runs (see [#324](https://github.com/auerbachb/still-point/issues/324)). Repeated identical simulator crashes will currently consume the full retry budget, then fail through the default branch; if cross-attempt stack-identity detection becomes important, file a follow-up.

### Web lanes

`scripts/e2e/run-playwright-lane.mjs` runs Playwright with `--retries 0` and owns retries itself at the **whole-lane** level (not Playwright's per-test reporter), so a single non-retriable failure fails the lane fast instead of silently re-running. Each attempt tees its output to `artifacts/e2e/web/<lane>/attempt-<N>.log` and creates a start-of-attempt sentinel `artifacts/e2e/web/<lane>/attempt-<N>.start` (its mtime is fixed at attempt start — crash dumps are compared against it, never against the tee'd log whose mtime keeps advancing). After a failed attempt the runner consults `scripts/e2e/classify-web-failure.mjs`, which mirrors the iOS precedence:

1. **Crash / browser-loss first** — if `$E2E_WEB_CRASH_DIR` (when set) holds a crash dump newer than the attempt-start sentinel, **or** the log shows a browser-process loss signature (`Target ... has been closed/crashed`, `Page crashed`, `Browser closed unexpectedly`, `browserType.launch:` failures, `Executable doesn't exist`), the failure is treated as infra and consumes a retry **regardless of any concurrent `expect(...)` line** — a crashed browser commonly surfaces as a failed assertion.
2. **Non-retriable assertion / contract check second** — Playwright `expect(...)` failures (assertion mismatches **and** selector-contract drift both surface as `expect(locator).toBeVisible() failed`), visual/snapshot mismatches (`Screenshot comparison failed`, `toMatchSnapshot`/`toHaveScreenshot`), and schema/data-contract violations (`ZodError`, `…SchemaError`) exit the lane without consuming the retry budget.
3. **Default** — any other failure (network timeouts such as `net::ERR_*`/`ECONNREFUSED`, dev-server boot stalls, runner disconnects, unknown crashes) is retriable up to the table value.

Web intentionally diverges from iOS in one place: iOS treats timeout-shaped UI waits as auto-retriable, but web does **not**, because selector-contract drift is non-retriable here and presents as an `expect(...)` failure. Action/navigation `TimeoutError`s that are not `expect(...)` failures still fall through to the retriable default.

## 3) Naked-sleep check exemptions (`e2e-policy.md` §3)

The ban and the two allowed exemption forms are in [`e2e-policy.md` §3](./e2e-policy.md#3-deterministic-waits-policy). `scripts/e2e/check-no-naked-sleep.mjs` matches them this way:

- **Workflow shell retry** — the line `sleep $((attempt * N))`, trimmed, must be alone on its line and in a file under `.github/workflows/`. The same text anywhere else (an `e2e/` spec, any other script) still fails (Issue #935).
- **Provisioning-script lines** — `ALLOWED_SLEEP_LINES_BY_PATH` maps one repo-relative path to the exact line texts it allows; each entry's comment says what the back-off retries. A pattern must match the whole trimmed line, so a sleep written any other way in that file still fails. Matching is by text, not by line number or count, so another line in that file with exactly an allowed text passes too.
- **Current entries** — the only path entry today is the `git ls-remote` / tag-push retry in `scripts/ci/ios-testflight-build-number.mjs` (Issue #920).

`scripts/e2e/check-no-naked-sleep.test.ts` (run by `npm run test:unit`) runs the check over the repository on every PR and pins the scope of these exemptions.
