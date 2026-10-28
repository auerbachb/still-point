# StillPoint iOS UI Tests

This directory contains native iOS UI smoke tests for Issue #193 ("journeys beyond auth, layout & VoiceOver smoke").

## Docs in this folder

- **This README** — reference simulator, coverage map, how to run, CI lanes, where the code lives, manual VoiceOver steps.
- [`LAUNCH_ENVIRONMENT.md`](LAUNCH_ENVIRONMENT.md) — every `SP_UI_TEST_*` launch knob the app reads, UI-test-only markers, and the fixture login account. Add new knobs there.
- [`PITFALLS.md`](PITFALLS.md) — simulator and XCUITest traps already hit, with the shipped fix for each. Add new pitfalls there.

## Reference simulator

- **Model:** `iPhone 15 Pro` (notch + Dynamic Island + home indicator)
- **OS:** iOS 17.0+
- **Cold-start auth bound (documented):** auth check should complete within **5,000 ms** on this simulator class.

Cold-start acceptance guard used by tests: **auth check must complete within 8,000 ms** (captured via root accessibility value `coldStartAuthCheckMs=<n>`). Raised from 5,000 ms in [#334](https://github.com/auerbachb/still-point/issues/334) to absorb macos-26/iOS-26 simulator contention. The guard is asserted only on `seedAuthenticated: false` cold-start paths (boot to auth); authenticated boots and seeded relaunches pass `assertColdStart: false`.

## Test coverage map (Issue #193 / #497)

One line per journey, naming the test that covers it. The cross-platform journey matrix is [`docs/testing/e2e-coverage-matrix.md`](../../docs/testing/e2e-coverage-matrix.md).

- Launch → login (fixture) → main session surface + cold-start bound (`testLaunchLoginCompleteSessionAndHistoryPersistence`)
- Start session → complete → stats visible + relaunch history persistence (`testLaunchLoginCompleteSessionAndHistoryPersistence`)
- Thought/distraction hold controls do not stick (`testLaunchLoginCompleteSessionAndHistoryPersistence`)
- Quick minute completes without advancing day (`testQuickMinuteCompletesWithoutDayAdvance`)
- Logout returns to auth screen (`testLogoutReturnsToAuthScreen`)
- Journal and board tabs reachable (`testJournalAndBoardTabsReachable`)
- History/Settings smoke navigation path (`testHistoryAndSettingsNavigationSmoke`)
- Layout on reference device safe areas (`testPrimaryControlsVisibleAboveHomeIndicator`)
- Rotation policy assertion (product decision: supported and still usable) (`testRotationDecisionSessionRemainsUsableInLandscape`)
- Keyboard overlap reachability (`testKeyboardOverlapKeepsSubmitReachable`)
- VoiceOver smoke labels for timer + primary button (`testVoiceOverLabelsForTimerAndPrimaryButton`)
- SPCapsuleButtonStyle rendering on buddy hub, breath counting, and app gate settings (`SPCapsuleButtonStyleUITests`)
- Airplane-mode style launch failure message (`testLaunchOfflineShowsUserVisibleMessage`)
- Token expiry re-auth path (`testTokenExpiryRoutesToReauthMessage`)
- Failed sessions API displays visible error (no silent hang) (`testSessionsFailureShowsVisibleRetryMessage`)
- Settings save dropped by an account switch re-syncs the control from the account on screen (`testAphorismsToggleResyncsWhenHeldReadAdoptsSecondAccount`, #887)
- A sit left pending sync hides the mood ratings, keeps the note, and leaves on the first "save and return to home" tap (`testPendingSyncCompletionHidesMoodAndReturnsOnFirstTap`, #875)

## Run locally

```bash
cd ios
xcodebuild test \
  -project StillPoint.xcodeproj \
  -scheme StillPoint \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro,OS=17.0' \
  -only-testing:StillPointAppUITests
```

Launch knobs and the fixture login account: [`LAUNCH_ENVIRONMENT.md`](LAUNCH_ENVIRONMENT.md).

## CI lane plan

Coverage matrix: [`docs/testing/e2e-coverage-matrix.md`](../../docs/testing/e2e-coverage-matrix.md). Lanes are wired in `scripts/e2e/run-ios-tests.sh` (`smoke` = golden path; `critical` = resilience + settings + quick minute + logout + journal/board).

## CI setup de-duplication notes

- **Cross-reference #155/#156:** reuse shared simulator boot, xcodegen generation, and cache priming steps from those issues so iOS lanes do not duplicate setup work unnecessarily.
- Keep auth/session fixture bootstrapping in app-side launch environment (this folder) rather than cloning separate backend setup in each lane.

## Where helpers live

- [`Helpers/XCTestCase+StillPointUITest.swift`](Helpers/XCTestCase+StillPointUITest.swift) — `makeApp` (the launch-environment knobs in [`LAUNCH_ENVIRONMENT.md`](LAUNCH_ENVIRONMENT.md)), `waitForRoot`, `stableFrame`, and the capsule rendering asserts. Shared by every UI test class.
- [`Helpers/StillPointAppUITests+Interaction.swift`](Helpers/StillPointAppUITests+Interaction.swift) — fixture login, Settings username editing, tab navigation, stable-center taps, scrolling, keyboard handling, and reliable termination for `StillPointAppUITests`. Scoped to that class so `SnapshotTests` can keep its own same-named private helpers.
- [`Helpers/XCUIElement+TapAndType.swift`](Helpers/XCUIElement+TapAndType.swift) — `tapAndType`: tap a field, wait for keyboard focus on it, then type.
- [`Helpers/XCUIDevice+Portrait.swift`](Helpers/XCUIDevice+Portrait.swift) — `ensurePortraitOrientation`, which skips the orientation change when the device is already portrait.
- [`StillPointAppUITests.swift`](StillPointAppUITests.swift) — setup, teardown, and the test methods.
- [`SPCapsuleButtonStyleUITests.swift`](SPCapsuleButtonStyleUITests.swift) — capsule button rendering checks.
- [`Snapshots/`](Snapshots/) — `SnapshotTests` and `SnapshotHelper` for the Fastlane screenshot lane.

## VoiceOver smoke steps (manual fallback)

1. Enable VoiceOver in the simulator (`Settings -> Accessibility -> VoiceOver`).
2. Launch the app with UI-test fixture mode (`SP_UI_TEST_MODE=1`) and log in as the fixture user.
3. Focus the Home primary CTA and confirm it is announced as **"Start session"**.
4. Activate Start session, then focus the timer element and confirm it announces **"Time remaining mm:ss"**.
5. Use swipe/right navigation to move to the primary session controls and confirm the path remains navigable through start -> completion -> return.
