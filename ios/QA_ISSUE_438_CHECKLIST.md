# Issue #438 — On-device TestFlight QA Checklist

**Issue:** [#438 — verify buddy video camera/mic + stillpoint:// deep links + background audio](https://github.com/auerbachb/still-point/issues/438)

**Fix under test:** [#433](https://github.com/auerbachb/still-point/pull/433) — restored `CFBundleURLTypes` (`stillpoint://`), `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, and `UIBackgroundModes [audio]`.

**Build gate:** Use a TestFlight build cut from `main` **after** #433 merged (2026-06-17). **Do not validate on Build 11 / v1.0.3** — those builds are still affected. Current RC in `ios/project.yml`: **v1.0.3 (build 17)**.

**QA owner:** _______________  
**Device model + iOS version:** _______________  
**TestFlight build number tested:** _______________  
**Date:** _______________

---

## 1) Issue #438 acceptance criteria (device-required)

| AC | Scenario | Test steps | Pass | Fail | Notes |
|---|---|---|:---:|:---:|---|
| **AC-1** | Buddy **video** session — camera + mic permissions | 1. Fresh install or reset camera/mic permissions for Still Point.<br>2. Start or join a buddy session with **video** enabled.<br>3. Confirm **camera** permission prompt appears (not instant crash).<br>4. Confirm **microphone** permission prompt appears.<br>5. Grant both → local preview + remote video/audio work. | ⬜ | ⬜ | Hard crash without `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` when WKWebView calls `getUserMedia` (`BuddyVideoWebView.swift`). |
| **AC-2** | Daily-reminder push → `stillpoint://home` | 1. Enable daily reminder notifications; wait for push (or send test push with `deepLink: stillpoint://home`).<br>2. **Cold start:** force-quit app → tap notification → app opens to **Home**.<br>3. **Warm start:** background app → tap notification → returns to **Home**. | ⬜ | ⬜ | Wired via `PushNotificationCoordinator` → `AppViewModel.handlePushDeepLink` → `openHomeFromNotification()` (#387). |
| **AC-3** | Buddy invite deep link `stillpoint://buddy/<token>` | 1. Obtain a valid buddy invite link/token.<br>2. **Cold start:** open link in Notes/Safari → app routes to **buddy join flow** (not crash / not stuck on auth).<br>3. **Warm start:** repeat from background.<br>4. If logged out, confirm invite is queued and consumed after login. | ⬜ | ⬜ | `AppViewModel.handleIncomingURL` → `extractBuddyToken` → `joinBuddySession`. Requires network + valid token. |
| **AC-4** | Session deep links | 1. Open `stillpoint://session` → starts **standard** session (when signed in, not already in session).<br>2. Open `stillpoint://session/quick` → starts **quick-minute** session.<br>3. Test cold + warm launch.<br>4. If logged out, confirm session type is queued until after auth. | ⬜ | ⬜ | Parsed by `SessionDeepLinkParser`; opened via `openSessionDeepLink`. |
| **AC-5** | Background audio mid-session | 1. Start a solo session with tick/chime or voice countdown enabled.<br>2. Background the app (Home gesture) → **audio continues** ≥10 s.<br>3. Lock device screen → audio continues.<br>4. Return to foreground → session UI intact, no crash. | ⬜ | ⬜ | Requires `UIBackgroundModes: [audio]` + `AudioEngine` `.playback` category. Simulator cannot reliably validate background audio. |

**Issue #438 gate:** All five AC rows must be **Pass** before closing #438.

---

## 2) Config-level pre-checks (automatable — no device)

Run before on-device QA to catch regressions before installing TestFlight.

| Check | Command / source | Pass | Fail | Agent result (2026-07-23) |
|---|---|:---:|:---:|---|
| Info.plist sync with `project.yml` | `cd ios && xcodegen generate && git diff --exit-code -- StillPointApp/Info.plist` | ⬜ | ⬜ | ✅ **Pass** |
| `stillpoint` URL scheme present | `PlistBuddy -c 'Print :CFBundleURLTypes' ios/StillPointApp/Info.plist` | ⬜ | ⬜ | ✅ **Pass** — `CFBundleURLSchemes` includes `stillpoint` |
| Camera usage string present | `PlistBuddy -c 'Print :NSCameraUsageDescription' …` | ⬜ | ⬜ | ✅ **Pass** |
| Microphone usage string present | `PlistBuddy -c 'Print :NSMicrophoneUsageDescription' …` | ⬜ | ⬜ | ✅ **Pass** |
| Background audio mode present | `PlistBuddy -c 'Print :UIBackgroundModes' …` | ⬜ | ⬜ | ✅ **Pass** — includes `audio` |
| Shared unit tests | `cd ios/StillPointShared && swift test` | ⬜ | ⬜ | ✅ **Pass** — 288/288 tests |

---

## 3) Adjacent features — verify on same TestFlight pass (recent merges)

These are **not** #438 blockers but share camera/audio/deep-link/session surfaces. Failures here should be filed separately.

| Ref | Feature | Why verify with #438 | Pass | Fail | Notes |
|---|---|---|:---:|:---:|---|
| [#433](https://github.com/auerbachb/still-point/pull/433) | Info.plist keys in shipped build | Root fix for #438 | ⬜ | ⬜ | Config pre-checks above cover plist; AC-1/2/4/5 confirm runtime. |
| [#387](https://github.com/auerbachb/still-point/pull/387) | Push deep-link handler consolidation | AC-2 depends on single wiring in `RootView` | ⬜ | ⬜ | Covered by AC-2. |
| [#591](https://github.com/auerbachb/still-point/pull/591) / [#590](https://github.com/auerbachb/still-point/issues/590) | Breath-counting unlocks app gate | Session completion side effect | ⬜ | ⬜ | **Device + Screen Time:** enable app gate → complete breath sit → blocked apps unlock. |
| [#618](https://github.com/auerbachb/still-point/pull/618) / [#564](https://github.com/auerbachb/still-point/issues/564) | Session environment photo | Uses `NSCameraUsageDescription` (second camera surface) | ⬜ | ⬜ | Complete session → "Add photo" → Take Photo → permission prompt (not crash) → thumbnail in history. |
| [#619](https://github.com/auerbachb/still-point/pull/619) / [#554](https://github.com/auerbachb/still-point/issues/554) | Voice countdown (final 60 s) | Audio stack / background interaction | ⬜ | ⬜ | Enable voice toggle → final minute speaks; ticks/chimes suppressed; completion sound plays. Unit-tested (`VoiceCountdownLogicTests`). |
| [#635](https://github.com/auerbachb/still-point/issues/635) / [#472](https://github.com/auerbachb/still-point/issues/472) | Before/after mood matrix on recap | Completion flow regression | ⬜ | ⬜ | Complete session → mood matrix visible on recap; values persist. |
| Gaze tracking (Settings) | `attentionTrackingEnabled` camera consent | Third camera permission surface | ⬜ | ⬜ | First toggle ON → camera prompt (not crash). Optional if AC-1 passes. |
| `stillpoint://log-reason?date=…` | Failure-reason reminder deep link | Same URL-scheme plumbing as AC-2–4 | ⬜ | ⬜ | Tap failure-reason push or open URL → log-reason screen. |

---

## 4) Simulator coverage (limited)

| Suite | Covers #438? | Result (2026-07-23) |
|---|---|---|
| `StillPointShared` unit tests | Partial — voice countdown logic, prefs migration; **no** deep-link parser tests | ✅ 288/288 pass |
| Info.plist sync guard | Yes — keys present in generated plist | ✅ Pass |
| `StillPointAppUITests` smoke | **No** — auth/session golden path only; no camera, push, deep links, or background audio | ⚠️ **Blocked** — local Xcode missing iOS 26.5 platform for scheme destination |
| WKWebView `getUserMedia` / push notifications / background audio | **No** — require physical device | ➖ Not automatable in CI/simulator |

---

## 5) Manual deep-link probes (device or Mac + `simctl openurl`)

If using Simulator with a signed build, these URLs can smoke-test routing (not a substitute for AC-1/2/5):

```bash
# Replace BUNDLE_ID if needed
BUNDLE=com.brettonauerbach.stillpoint
xcrun simctl openurl booted "stillpoint://home"
xcrun simctl openurl booted "stillpoint://session"
xcrun simctl openurl booted "stillpoint://session/quick"
xcrun simctl openurl booted "stillpoint://buddy/TEST_TOKEN"
```

On device: paste links in Notes and tap, or use Safari address bar.

---

## 6) Sign-off

- [ ] All §1 AC rows marked **Pass**
- [ ] §2 config pre-checks **Pass**
- [ ] TestFlight build number + device recorded above
- [ ] Failures logged as new issues (do not close #438 with open failures)
- [ ] Update `ios/QA_CHECKLIST.md` §1/§2 regression rows when complete

**Close #438 when:** All five AC rows pass on a post-#433 TestFlight build on a physical device.
