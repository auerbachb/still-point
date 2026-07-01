# iOS vs Web Feature Parity Checklist (Issue #210)

Last updated: 2026-06-03  
Release owner: iOS release DRI

## Core product parity

| Area | Web | iOS | Status | Notes |
|---|---|---|---|---|
| Auth (sign up / login / logout / persisted session) | Implemented | Implemented | ✅ Complete | iOS uses the same `/api/auth/*` endpoints via `StillPointShared/APIClient.swift`. |
| Home + day progression CTA | Implemented | Implemented | ✅ Complete | “Begin” + day-based duration behavior is present on both clients. |
| Solo session timer + pause for “I’m thinking” | Implemented | Implemented | ✅ Complete | Shared session timing logic is in `StillPointShared/SessionLogic.swift`. |
| Thought capture during session | Implemented | Implemented | ✅ Complete | Both clients write to `/api/thoughts/batch`. |
| Completion screen + end note | Implemented | Implemented | ✅ Complete | End note uses `timeInSession = -1` in both clients. |
| Progress/history view | Implemented | Implemented | ✅ Complete | iOS `HistoryView` maps to web `HistoryView`. |
| Thought journal | Implemented | Implemented | ✅ Complete | iOS `ThoughtJournalView` maps to web `ThoughtJournal`. |
| Public board + visibility toggle | Implemented | Implemented | ✅ Complete | iOS `SettingsView` includes `isPublic` toggle and board read. |
| Buddy session create/join/wait/start/leave/complete | Implemented | Implemented | ✅ Complete | iOS uses same buddy session API contract as web. |
| Buddy calendar (unified + per-buddy, filters, pagination) | Implemented | Implemented | ✅ Complete | iOS `BuddyCalendarView` mirrors web `BuddyCalendarView`; entry via `BuddySessionHubView` until Friends tab ships. |
| Buddy invite deep links | Implemented | Implemented | ✅ Complete | iOS handles `stillpoint://buddy` and web invite URL forms. |
| Account deletion flow | Implemented | Implemented | ✅ Complete | iOS Settings includes two-step destructive confirmation. |
| Aphorisms pre-session inspiration toggle (#88) | Implemented | Implemented | ✅ Complete | Shared quote list in `StillPointShared/Aphorisms.swift` mirrors `src/lib/aphorisms.ts`; both clients toggle via `PATCH /api/settings`. |

## Known parity gaps (critical + non-critical)

| Gap | Severity | Decision | Owner | Target date | Tracking notes |
|---|---|---|---|---|---|
| Dedicated **Friends management UI** (search users, request/accept/reject/cancel, remove friend) exists on web (`FriendsView.tsx`) but not in iOS tabs. | Critical | Deferred for this release candidate (buddy core flow remains functional without in-app friend graph controls). | Mobile platform owner (@ios-release) | 2026-05-01 | Add iOS Friends tab + friend-request flows using existing API endpoints before next social feature milestone. |
| Marketing-only web homepage demo embed / App Store badge behavior has no iOS equivalent screen. | Non-critical | Explicitly out of scope for native parity. | Product (@product) | 2026-05-08 | Keep web-only marketing surfaces documented; no native action required. |

## Release gate decision (Issue #210)

- [x] Feature parity checklist between iOS and web is completed.
- [x] All critical parity gaps are fixed or explicitly deferred with owner/date.

The current release candidate is allowed to ship with the deferred critical gap above because it does not block session completion, account safety, or backend data integrity.
