# iOS vs Web Feature Parity Checklist (Issue #210)

Last updated: 2026-07-21 (#554 — voice countdown parity restored; completes #519–#529 series)  
Release owner: iOS release DRI

## Core product parity

| Area | Web | iOS | Status | Notes |
|---|---|---|---|---|
| Auth (sign up / login / logout / persisted session) | Implemented | Implemented | ✅ Complete | iOS uses the same `/api/auth/*` endpoints via `StillPointShared/APIClient.swift`. |
| Auth "last used" sign-in tag (#337 / #528) | OAuth only (Google, Apple) | All methods (email/password, Google, Apple) | ✅ Complete | Web: `AuthScreen.tsx` + `lastAuthProvider.ts`. iOS: `AuthView.swift` + `StillPointShared/LastAuthProvider.swift` (UserDefaults key `stillpoint_last_auth_provider`). |
| Home + day progression CTA | Implemented | Implemented | ✅ Complete | “Begin” + day-based duration behavior is present on both clients. |
| L1–L5 lesson pathway on Home (#452 / #525 / #587) | Implemented | Implemented | ✅ Complete | Shared structure in `src/lib/pathway.ts` / `StillPointShared/Pathway.swift`; UI in `Pathway.tsx` / `PathwayView.swift`. Coming-soon preview — not derived from day count. |
| Solo session timer + pause for “I’m thinking” | Implemented | Implemented | ✅ Complete | Shared session timing logic is in `StillPointShared/SessionLogic.swift`. |
| Thought capture during session | Implemented | Implemented | ✅ Complete | Both clients write to `/api/thoughts/batch`. |
| Completion screen + end note | Implemented | Implemented | ✅ Complete | End note uses `timeInSession = -1` in both clients. |
| Progress/history view | Implemented | Implemented | ✅ Complete | iOS `HistoryView` mirrors web calendar-first History: month grid, prior-month summaries, year-in-review, mind-state trends, and session-buildup journey toggle (#523/#520/#522). |
| Thought journal | Implemented | Implemented | ✅ Complete | iOS `ThoughtJournalView` maps to web `ThoughtJournal`. |
| Public board + visibility toggle | Implemented | Implemented | ✅ Complete | iOS `SettingsView` includes `isPublic` toggle and board read. |
| Buddy session create/join/wait/start/leave/complete | Implemented | Implemented | ✅ Complete | iOS uses same buddy session API contract as web. |
| Buddy calendar (unified + per-buddy, filters, pagination) | Implemented | Implemented | ✅ Complete | iOS `BuddyCalendarView` mirrors web `BuddyCalendarView`; entry via `BuddySessionHubView` until Friends tab ships. |
| Buddy invite deep links | Implemented | Implemented | ✅ Complete | iOS handles `stillpoint://buddy` and web invite URL forms. |
| Account deletion flow | Implemented | Implemented | ✅ Complete | iOS Settings includes two-step destructive confirmation. |
| Aphorisms pre-session inspiration toggle (#88) | Implemented | Implemented | ✅ Complete | Shared quote list in `StillPointShared/Aphorisms.swift` mirrors `src/lib/aphorisms.ts`; both clients toggle via `PATCH /api/settings`. |
| Failure-reason reminder + log-reason capture (#441 / web PR #466) | Implemented | Implemented | ✅ Complete | iOS exposes `failureReasonReminderEnabled` in Notifications settings, handles `stillpoint://log-reason?date=…`, and captures notes via `/api/failure-reasons`. |
| Miss-a-day recovery ramp (#481 / #511) | Implemented | Implemented | ✅ Complete | Shared ramp logic in `StillPointShared/DurationRecovery.swift`; applied in `AppViewModel.swift`, `SessionViewModel.swift`, `HomeView.swift`, and `CompletionView.swift`. |
| ARKit gaze attention tracking (#512) | Not applicable — web | Implemented (iOS-only) | ✅ Intentional iOS-only | TrueDepth/ARKit hardware requirement; consent-gated toggle in `SettingsView.swift`; core manager is `AttentionTrackingManager.swift`. Web has no camera-during-session equivalent by design — not a parity defect. |
| Voice countdown final-minute mode (#554, ports web PR #518 / Issue #507) | Implemented (`src/lib/audio.ts` + `BlockTimer.tsx`; `SoundPrefs.voiceCountdown` in localStorage) | Implemented | ✅ Complete | iOS: 60 pre-generated MP3 clips bundled at `ios/StillPointApp/Resources/VoiceCountdown/` (mirror of `scripts/generate-voice-countdown.ts` output); playback via `AudioEngine.playVoiceCountdown(seconds:)` + `preloadVoiceCountdown()` + `cancelVoiceCountdownPlayback()`; toggle persisted in `AudioEngine.SoundPrefs.voiceCountdown` (UserDefaults); fires in the final 60 s only, suppresses tick + per-minute chime, completion unaffected — semantics identical to web. Wired into both `SessionViewModel.tick()` (solo) and `BuddySessionViewModel` / `BuddyActiveSessionView` (buddy). Prefs decoder uses `decodeIfPresent` merge so existing users' saved preferences survive upgrade. Pure selection logic extracted to `StillPointShared/VoiceCountdownLogic.swift` with unit tests. Completes the #519–#529 parity series. |

## Known parity gaps (critical + non-critical)

| Gap | Severity | Decision | Owner | Target date | Tracking notes |
|---|---|---|---|---|---|
| Dedicated **Friends management UI** (search users, request/accept/reject/cancel, remove friend) exists on web (`FriendsView.tsx`) but not in iOS tabs. | Critical | Deferred for this release candidate (buddy core flow remains functional without in-app friend graph controls). | Mobile platform owner (@ios-release) | TBD (overdue from 2026-05-01; re-plan before next social feature milestone) | Add iOS Friends tab + friend-request flows using existing API endpoints before next social feature milestone. |
| Marketing-only web homepage demo embed / App Store badge behavior has no iOS equivalent screen. | Non-critical | Explicitly out of scope for native parity. | Product (@product) | 2026-05-08 | Keep web-only marketing surfaces documented; no native action required. |
| **Guided exercises (#517)** — branching breath/movement/insight exercises layered on the core timer. Web: `GuidedExerciseOverlay.tsx` + `src/lib/guidedExercise.ts`. | Non-critical | Deferred post-1.0; add to iOS feature roadmap. | Mobile platform owner (@ios-release) | TBD | No iOS surface exists. Part of June–July batch (#519–#529). |
| **Session ratings (#479)** — post-session quality slider. Web: `RatingSlider.tsx` + `/api/track`. | Non-critical | Deferred post-1.0. | Mobile platform owner (@ios-release) | TBD | No iOS surface exists. |
| **Last-used tag (#394)** — surfacing a "last used N days ago" indicator. Not built on either platform (net-new). | Non-critical | Not yet designed — add to backlog. | Product (@product) | TBD | Distinct from the auth-provider last-used sign-in tag (row above, #337/#528). `LastAuthProviderCapture.tsx` / `StillPointShared/LastAuthProvider.swift` handle a different feature. |

## Release gate decision (Issue #210)

- [x] Feature parity checklist between iOS and web is completed.
- [x] All critical parity gaps are fixed or explicitly deferred with owner/date.

The current release candidate is allowed to ship with the deferred critical gap above because it does not block session completion, account safety, or backend data integrity. The June–July batch (#519–#529) added additional non-critical web-only gaps (guided exercises, session ratings) and one net-new unbuilt item (last-used tag #394); none of these block the release gate.
