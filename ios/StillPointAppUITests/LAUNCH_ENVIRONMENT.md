# StillPoint iOS UI Tests — Launch environment

The app reads these launch environment keys in UI test mode. `makeApp` in [`Helpers/XCTestCase+StillPointUITest.swift`](Helpers/XCTestCase+StillPointUITest.swift) sets most of them on every launch; `SnapshotTests` sets its own. Overview and run instructions: [`README.md`](README.md).

Add a new knob as one row in the table that fits, naming the issue that added it.

## Mode and store

| Key | Effect |
|-----|--------|
| `SP_UI_TEST_MODE=1` | Turns on UI test mode (fake backend, fixture data). |
| `SP_UI_TEST_RESET_STORE=1` | Start each test from a deterministic fixture store. |
| `SP_UI_TEST_SEED_AUTH=1` | Boot an already-authenticated fixture user. |
| `SP_UI_TEST_SNAPSHOT_SEED=1` | Fastlane snapshot lane — canned sessions, thoughts, and practitioners board for marketing captures. Use with `SP_UI_TEST_RESET_STORE=1` on first launch. |

## Session timing

| Key | Effect |
|-----|--------|
| `SP_UI_TEST_SESSION_SECONDS=<int>` | Short deterministic session duration. |
| `SP_UI_TEST_TIMER_MULTIPLIER=<double>` | Accelerate the timer without changing UI copy. |

## Boot destination

| Key | Effect |
|-----|--------|
| `SP_UI_TEST_FORCE_START_SESSION=1` | Boot an authenticated launch straight into a standard session. |
| `SP_UI_TEST_FORCE_BREATH_COUNTING=1` | Boot directly to the breath counting screen. |
| `SP_UI_TEST_FORCE_BUDDY_HUB=1` | Boot directly to the buddy session hub. |
| `SP_UI_TEST_FORCE_SETTINGS_TAB=1` | Boot to the Settings tab in the main shell. Wins over `SP_UI_TEST_FORCE_PROGRESS_TAB` when both are set. |
| `SP_UI_TEST_FORCE_PROGRESS_TAB=1` | Boot to the Progress tab in the main shell. |
| `SP_UI_TEST_APP_BLOCKING_SELECTED=1` | Report app blocking as authorized with one app selected, so app gate settings render their selected state. |

## Failure simulation

| Key | Effect |
|-----|--------|
| `SP_UI_TEST_FORCE_LAUNCH_OFFLINE=1` | Simulate a failed API / airplane mode on launch. |
| `SP_UI_TEST_FORCE_TOKEN_EXPIRED=1` | Simulate an expired token during the cold-start auth check. |
| `SP_UI_TEST_FORCE_SESSIONS_FAILURE=1` | `getSessions` and `getTracksDoneToday` fail with a 503 on every call. |
| `SP_UI_TEST_FORCE_SESSIONS_FAILURE=once` | #957: only the first `getSessions` call in the launch fails with a 503, so History's Retry can load; `getTracksDoneToday` does not fail in this mode. |
| `SP_UI_TEST_FORCE_CREATE_SESSION_FAILURE=1` | #875: every `createSession` fails as a dead network does, so a completed sit stays pending sync. |
| `SP_UI_TEST_FORCE_USERNAME_CONFLICT=1` | Simulate a username taken on Settings save. |

## Account switching

| Key | Effect |
|-----|--------|
| `SP_UI_TEST_HOLD_ME_SECONDS=<double>` | #887: the first `me()` read after the app goes to the background — the scene-activation auth check when it comes back — waits this long before answering, holding the settings queue so a Settings save made meanwhile waits behind it. |
| `SP_UI_TEST_SECOND_ACCOUNT=1` | #887: that held read answers as a second account, `ios_second`, so the app adopts a different account while Settings stays on screen. |

## UI-test-only markers

`RootView` shows a UI-test-only marker, `uiTest.settingsRequestCount`, whose accessibility value is the number of Settings requests the fake backend has received since launch (#887).

## Fixture login account

Used when the auth screen is shown:

- Email: `ios.fixture@stillpoint.test`
- Password: `stillpoint-pass`
