# StillPoint iOS UI Tests — Patterns and pitfalls

Simulator and XCUITest traps the UI tests have already hit, with the fix that shipped for each. Overview and run instructions: [`README.md`](README.md).

Add a new pitfall as its own `##` section below, with the CI run or issue that shows it.

## Wait for the destination root before terminating after navigation

If a test triggers navigation (taps a button that pushes a new screen, starts audio, kicks off any non-trivial transition) and then calls `app.terminate()`, the simulator's `launchd` on macos-26 / iOS 26 sometimes loses track of the process and hangs for tens of seconds before reporting:

```text
Failed to terminate <bundle>:<pid>
```

The fix is to wait for the destination's `root.currentView.<slug>` element to exist *before* terminating, so SIGTERM hits a quiescent process.

**Do this:**

```swift
beginButton.tap()
XCTAssertTrue(
    app.otherElements["root.currentView.session"].waitForExistence(timeout: 20),
    "Session screen did not appear after Begin tap"
)
app.launchEnvironment["SP_UI_TEST_SEED_AUTH"] = "1"
terminateAppReliably(app)
```

**Don't do this:**

```swift
beginButton.tap()
// terminate races launchd while audio engine + timer are still spinning up
terminateAppReliably(app)
```

## When `tap(_:thenWaitForRoot:in:)` is fine vs when it bites

The `tap(_:thenWaitForRoot:in:)` helper in [`Helpers/StillPointAppUITests+Interaction.swift`](Helpers/StillPointAppUITests+Interaction.swift) is a one-liner for "tap, then wait for the destination root". Tests like `testRotationDecisionSessionRemainsUsableInLandscape` use it successfully. Internally it composes `tapByStableCenter` (an 8s stable-frame check) with a 12s root-existence wait, retried up to 3 times.

The trap: in flows where the source element's frame is briefly unstable (e.g. immediately after the home screen mounts following a fresh login), `tapByStableCenter` returns `false` *without ever tapping* — the helper then waits 12s for a root that never appears, retries, and ultimately asserts `Expected tap to transition to root.currentView.<slug>`.

Concrete case: the v1 commit (`d9e69aa`) of [#319](https://github.com/auerbachb/still-point/pull/319) used the helper for the post-login `home → session` transition in `testLaunchLoginCompleteSessionAndHistoryPersistence` and failed CI on [run 25218186115](https://github.com/auerbachb/still-point/actions/runs/25218186115). The shipping fix (`ddf7b69`) kept the direct `.tap()` and added an explicit `waitForExistence` for the destination root — verified passing on [run 25218888601](https://github.com/auerbachb/still-point/actions/runs/25218888601).

**Rule of thumb:**

- **Already-quiescent flows** (authenticated boot, lighter session config, no fresh transition in flight): `tap(_:thenWaitForRoot:in:)` is fine.
- **Right after a transition** (fresh login → home → tap, layout/animation likely still settling): use direct `.tap()` + explicit `waitForExistence` for the destination root.

## Never focus the Sign Up password field on iOS 26

When a `.newPassword` field takes focus, iOS 26 replaces the keyboard with a "Use Strong Password?" panel. The panel swallows `typeText` (only one character arrives). Its Close and Fill Strong Password buttons sit in a remote view whose frames XCUITest reports relative to the panel, not the screen, so a tap on them can't be relied on to land. `testSignupHappyPath` therefore types the password in Log In mode, where the field is a `.password` field. It moves focus to the email field before switching to Sign Up. Evidence: [run 40418500104](https://github.com/auerbachb/still-point/actions/runs/40418500104), [#867](https://github.com/auerbachb/still-point/issues/867).

## Scroll before tapping anything low on the completion recap

The recap (mood grid, photo button) is taller than the screen, so `completion.returnButton` starts below the fold. `tapByStableCenter` does not scroll, so call `scrollElementIntoVisibleFrame` first.
