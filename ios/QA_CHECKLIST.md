# iOS Release Candidate QA Checklist (Issue #210)

Release candidate: 1.0.3 (17)
Last updated: 2026-07-21
QA owner: iOS QA DRI

## 1) Smoke + regression pass

| Scenario | Expected result | Status | Notes |
|---|---|---|---|
| New user sign up | Account is created, user lands on Home day 1 | ✅ Pass | Verified against production API contract. |
| Existing user login/logout | Session resumes correctly, logout clears state | ✅ Pass | Includes re-open app after auth. |
| Solo session complete | Session persists, completion stats render | ✅ Pass | Covers timer, mind-state toggle, thought capture. |
| Solo session abandon | Partial session persists without day increment | ✅ Pass | Includes save-path for captured thoughts. |
| Completion note save | End note persists and appears in journal/history detail | ✅ Pass | Uses `timeInSession = -1`. |
| History + stats rendering | Session list and clear% chart data display correctly | ✅ Pass | Compared with web for same user. |
| Thought journal list | Thought feed loads with expected chronology | ✅ Pass | Mid-session + end notes both visible. |
| Public board visibility toggle | Toggle updates server and board participation | ✅ Pass | Includes off->on and on->off transitions. |
| Buddy create/join/start | Two participants can create, join, ready, and start | ✅ Pass | Deep-link invite join path validated. |
| Buddy leave/cancel + personal completion save | Exit/cancel behavior and personal save remain correct | ✅ Pass | Session teardown and return navigation verified. |
| Delete account safety flow | Two-step confirmation then sign-out/auth screen | ✅ Pass | Matches App Review guideline flow in `RELEASING.md`. |
| **Camera/mic permission regression (#433)** | Buddy-video WKWebView `getUserMedia` grant succeeds; gaze-tracking camera consent is shown on first `attentionTrackingEnabled` toggle | ⬜ | `BuddyVideoWebView.swift` (getUserMedia path); `SettingsView.swift` (gaze toggle); `NSCameraUsageDescription` + `NSMicrophoneUsageDescription` in `ios/project.yml`. |
| **Deep-link routing regression (#433)** | Push-tap and `stillpoint://buddy/…` invite links open the correct screen on cold start and from background | ⬜ | `.onOpenURL` in `RootView.swift`; custom-scheme `stillpoint://` only — no universal-links/associated-domains path exists. |

## 2) Platform checks

| Check | Status | Notes |
|---|---|---|
| Cold launch stability | ✅ Pass | No crash on first launch with signed-in user. |
| Foreground/background resume | ✅ Pass | Session state is preserved on short background transitions. |
| Network offline handling | ✅ Pass | API errors surface user-readable messaging for critical paths. |
| Light/dark appearance sanity | ✅ Pass | Core screens remain legible and themed correctly. |
| **Background-audio regression (#433)** | ⬜ | Timer tick/chime stays audible while backgrounded; resume does not crash. `UIBackgroundModes: [audio]` in `ios/project.yml`; `.playback`/interruption handling in `StillPointShared/AudioEngine.swift` (includes `#262` crash-avoidance guard). |

## 3) Release metadata + submission readiness

- [x] `ios/project.yml` versioning finalized: `MARKETING_VERSION = 1.0.3`, `CURRENT_PROJECT_VERSION = 17`.
- [x] App Store release notes finalized for this build (see `ios/RELEASING.md`).
- [x] App Store metadata checklist finalized (privacy policy URL, support URL, account deletion review notes).
- [x] App Store submission automation dry-run evidence can be generated with `npm run ios:app-store:dry-run`.
  - Evidence artifact: `artifacts/ios-app-store-dry-run/summary.md`.
  - Live ASC validation requires `APPSTORE_APP_ID` plus the App Store Connect API key environment variables.
- [ ] Build submitted to App Store review in App Store Connect.
  - Owner: iOS release DRI
  - Target date: TBD (re-evaluate after build 17 TestFlight smoke test passes)
  - Completion evidence: attach App Store Connect submission timestamp and build number in PR comment.

## Release gate decision (Issue #210)

- [ ] Regression/QA pass for release candidate is completed. (Re-opened: camera/mic, deep-link, and background-audio regression checks added for build 17 — see §1 and §2 above.)
- [x] App Store metadata/versioning/release notes are finalized.
- [ ] Updated iOS build is submitted to App Store by end of week.

## Pre-tag manual smoke (Issue #253)

Run these on a Release-signed device install **before** pushing the `ios-v*` tag.
The CI pre-flight gate runs the same suite in Release config on simulator, but a
real-device pass before tagging is the final guard against optimization/codegen
bugs that only surface on hardware (e.g. the build 8 Begin-tap crash).

- [ ] Install the just-uploaded TestFlight build on a physical device via the TestFlight app (so QA exercises the exact archive that will ship). Alternative if TestFlight processing is delayed: in Xcode, **Product → Archive**, then **Distribute App → Custom → Ad Hoc** to export an `.ipa`, then drag the `.ipa` onto your device in **Window → Devices and Simulators**. A bare `.xcarchive` is not directly installable.
- [ ] Sign in with a known account.
- [ ] Tap **Begin** and verify the timer screen loads without crash.
- [ ] Let the session run to completion (or End Early) and verify CompletionView appears.
- [ ] Type a session note, tap **Save note**, and verify the green "Saved" indicator.
- [ ] Tap **Return** and verify Home reflects the new day count.
- [ ] Pull crash logs from device after the run (Settings → Privacy & Security → Analytics & Improvements → Analytics Data) and verify no `StillPointApp-*.ips` from this session.
- [ ] Record the device model + iOS version in the release PR before pushing the tag.
