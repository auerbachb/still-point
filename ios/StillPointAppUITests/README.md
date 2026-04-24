# StillPoint iOS UI Tests

This directory contains native iOS UI smoke tests for Issue #193 ("journeys beyond auth, layout & VoiceOver smoke").

## Reference simulator

- **Model:** `iPhone 15 Pro` (notch + Dynamic Island + home indicator)
- **OS:** iOS 17.0+
- **Cold-start auth bound (documented):** auth check should complete within **5,000 ms** on this simulator class.

## Test coverage map (Issue #193)

- Launch → login (fixture) → main session surface + cold-start bound (`testLaunchLoginCompleteSessionAndHistoryPersistence`)
- Start session → complete → stats visible + relaunch history persistence (`testLaunchLoginCompleteSessionAndHistoryPersistence`)
- Thought/distraction hold controls do not stick (`testLaunchLoginCompleteSessionAndHistoryPersistence`)
- History/Settings smoke navigation path (`testHistoryAndSettingsNavigationSmoke`)
- Layout on reference device safe areas (`testPrimaryControlsVisibleAboveHomeIndicator`)
- Rotation policy assertion (product decision: supported and still usable) (`testRotationDecisionSessionRemainsUsableInLandscape`)
- Keyboard overlap reachability (`testKeyboardOverlapKeepsSubmitReachable`)
- VoiceOver smoke labels for timer + primary button (`testVoiceOverLabelsForTimerAndPrimaryButton`)
- Airplane-mode style launch failure message (`testLaunchOfflineShowsUserVisibleMessage`)
- Token expiry re-auth path (`testTokenExpiryRoutesToReauthMessage`)
- Failed sessions API displays visible error (no silent hang) (`testSessionsFailureShowsVisibleRetryMessage`)

Cold-start acceptance guard used by tests: **auth check must complete within 5,000 ms** (captured via root accessibility value `coldStartAuthCheckMs=<n>`).

## Environment knobs used by tests

The app reads these launch environment keys in UI test mode:

- `SP_UI_TEST_MODE=1`
- `SP_UI_TEST_RESET_STORE=1` (start each test from a deterministic fixture store)
- `SP_UI_TEST_SEED_AUTH=1` (boot already-authenticated fixture user)
- `SP_UI_TEST_SESSION_SECONDS=<int>` (short deterministic session duration)
- `SP_UI_TEST_TIMER_MULTIPLIER=<double>` (accelerate timer without changing UI copy)
- `SP_UI_TEST_FORCE_LAUNCH_OFFLINE=1` (simulate failed API/airplane mode on launch)
- `SP_UI_TEST_FORCE_TOKEN_EXPIRED=1` (simulate expired token during cold-start auth check)
- `SP_UI_TEST_FORCE_SESSIONS_FAILURE=1` (optional sessions API failure simulation)

Fixture login account (used when auth screen is shown):

- Email: `ios.fixture@stillpoint.test`
- Password: `stillpoint-pass`

## Run locally

```bash
cd ios
xcodebuild test \
  -project StillPoint.xcodeproj \
  -scheme StillPoint \
  -destination 'platform=iOS Simulator,name=iPhone 15 Pro,OS=17.0' \
  -only-testing:StillPointAppUITests
```

## CI lane plan (stub until #152 merges)

Planned lane: `ios-ui-smoke`

1. Boot simulator `iPhone 15 Pro` on iOS 17.x.
2. Run the command above (or equivalent lane wrapper).
3. Upload XCTest result bundle artifact.
4. Publish summarized pass/fail output back to PR checks.

## CI setup de-duplication notes

- **Cross-reference #155/#156:** reuse shared simulator boot, xcodegen generation, and cache priming steps from those issues so iOS lanes do not duplicate setup work unnecessarily.
- Keep auth/session fixture bootstrapping in app-side launch environment (this folder) rather than cloning separate backend setup in each lane.

## VoiceOver smoke steps (manual fallback)

1. Enable VoiceOver in the simulator (`Settings -> Accessibility -> VoiceOver`).
2. Launch the app with UI-test fixture mode (`SP_UI_TEST_MODE=1`) and log in as the fixture user.
3. Focus the Home primary CTA and confirm it is announced as **"Start session"**.
4. Activate Start session, then focus the timer element and confirm it announces **"Time remaining mm:ss"**.
5. Use swipe/right navigation to move to the primary session controls and confirm the path remains navigable through start -> completion -> return.
