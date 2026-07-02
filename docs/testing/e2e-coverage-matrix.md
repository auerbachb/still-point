# E2E Journey Coverage Matrix (Issue #497)

Published audit of user journeys across **web** (Playwright mobile web) and **iOS** (XCUITest). Supersedes the ad-hoc coverage notes in [#190](https://github.com/auerbachb/still-point/issues/190) and locator-contract tracking in [#152](https://github.com/auerbachb/still-point/issues/152).

**Risk tiers**

| Tier | Meaning | CI lane |
|------|---------|---------|
| **P0** | Core retention path; regression blocks merge | `@smoke` / `@critical` (web PR lanes); iOS smoke/critical |
| **P1** | High-value adjacent flows; covered in release or platform lanes | Full mobile web suite (`e2e-mobile.yml`); iOS critical where noted |
| **P2** | Lower blast radius, manual QA, or unit/integration only | Tracked; no merge gate in v1 |

**Coverage symbols:** ✅ automated E2E · ⚠️ partial (edge case or API-only) · ❌ not automated · ➖ N/A (platform lacks surface)

Lane wiring and retry policy: [`e2e-policy.md`](./e2e-policy.md). Spec layout: [`e2e/README.md`](../../e2e/README.md), [`ios/StillPointAppUITests/README.md`](../../ios/StillPointAppUITests/README.md).

---

## Matrix

| Journey | Risk | Web | iOS | Spec / test reference |
|---------|:----:|:---:|:---:|------------------------|
| **Public** |
| Landing page CTAs | P0 | ✅ | ➖ | `e2e/web/smoke.spec.ts` `@smoke` |
| Privacy / delete-account pages | P2 | ❌ | ➖ | Manual / unit |
| **Auth (email/password)** |
| Auth shell visible (`/app`) | P0 | ✅ | ✅ | `e2e/web/critical.spec.ts`; iOS auth cold-start tests |
| Signup → authenticated home | P0 | ✅ | ⚠️ | `e2e/auth/signup.spec.ts` `@critical`; iOS uses fixture login in smoke |
| Login → home shell | P0 | ✅ | ✅ | `e2e/auth/login.spec.ts` `@critical`; `testLaunchLoginCompleteSessionAndHistoryPersistence` |
| Logout → auth screen | P0 | ✅ | ✅ | `e2e/settings/logout.spec.ts` `@critical`; `testLogoutReturnsToAuthScreen` |
| Password reset — request | P1 | ✅ | ✅ | `e2e/auth/password-reset.spec.ts`; `testPasswordResetEntryIsDiscoverable` |
| Password reset — confirm + re-login | P1 | ✅ | ❌ | `e2e/auth/password-reset.spec.ts` `@critical`; iOS request-only |
| Password reset — no enumeration | P1 | ✅ | ❌ | `e2e/auth/password-reset.spec.ts` |
| Auth 401 / token expiry → login | P1 | ✅ | ✅ | `e2e/auth/login.spec.ts`; `testTokenExpiryRoutesToReauthMessage` |
| Auth network failure + Retry | P1 | ✅ | ✅ | `e2e/auth/login.spec.ts`; `testLaunchOfflineShowsUserVisibleMessage` |
| Deleted account (410) message | P2 | ✅ | ❌ | `e2e/auth/login.spec.ts` |
| Username uniqueness / race (DB) | P1 | ✅ | ❌ | `e2e/auth/username-uniqueness.integration.spec.ts` (`@authDbIntegration`) |
| **OAuth (excluded)** |
| Google / Apple OAuth (web) | — | ❌ | ➖ | **Excluded** — see [Exclusions](#exclusions) |
| Google / Apple native (iOS) | — | ➖ | ❌ | **Excluded** |
| **Tab routing & deep links** |
| Default `/app` → home/progress | P0 | ✅ | ✅ | `e2e/routing/tab-routing.spec.ts` `@smoke`; iOS smoke |
| Per-tab URLs + deep links | P1 | ✅ | ⚠️ | `e2e/routing/tab-routing.spec.ts`; iOS history/settings smoke only |
| Buddy invite deep link | P1 | ✅ | ❌ | `e2e/routing/tab-routing.spec.ts` (mocked join) |
| Browser back clears session overlay | P1 | ✅ | ➖ | `e2e/routing/tab-routing.spec.ts` |
| **Home & sessions** |
| Standard session begin → complete → return | P0 | ✅ | ✅ | `e2e/session/session-flow.spec.ts` `@critical`; iOS smoke golden path |
| Session history persistence after relaunch | P0 | ⚠️ | ✅ | Web mocked POST only; iOS smoke |
| Quick minute (no day advance) | P1 | ✅ | ✅ | `e2e/session/session-flow.spec.ts`; `testQuickMinuteCompletesWithoutDayAdvance` |
| Mind-state holds (light / hyperfocus) | P1 | ✅ | ✅ | `e2e/session/session-flow.spec.ts`; iOS smoke |
| End early / completion stats | P0 | ✅ | ✅ | `e2e/session/session-flow.spec.ts` `@critical`; iOS smoke |
| Pause / abandon / thought capture | P2 | ❌ | ❌ | QA manual; snapshot lane only |
| Landscape session usability | P1 | ✅ | ✅ | `e2e/session/session-flow.spec.ts`; `testRotationDecisionSessionRemainsUsableInLandscape` (non-critical lane) |
| Pull-to-refresh during session | P2 | ✅ | ➖ | `e2e/session/session-flow.spec.ts` |
| **Breath counting (excluded)** |
| Full breath-counting UX | — | ⚠️ | ❌ | **Excluded** — see [Exclusions](#exclusions) |
| **History / journal / board** |
| History list + scroll | P1 | ✅ | ✅ | `e2e/layout/overflow.spec.ts`; iOS smoke + `testSessionsFailureShowsVisibleRetryMessage` |
| Calendar / journey view modes | P2 | ❌ | ❌ | Unit tests (`historyJourney.test.ts`, `HistoryJourneyTests.swift`) |
| Thought journal tab | P2 | ⚠️ | ✅ | Web layout FlashHint; `testJournalAndBoardTabsReachable` |
| Public board tab | P2 | ✅ | ✅ | `e2e/layout/issue-473-mobile-web-layout.spec.ts`; `testJournalAndBoardTabsReachable` |
| **Friends / buddy** |
| Friends search & requests (web) | P2 | ❌ | ➖ | Web-only surface |
| Buddy room UI (video, lobby) | P2 | ❌ | ❌ | QA manual; Daily.co third-party |
| Buddy duration normalization (API) | P1 | ✅ | ❌ | `e2e/buddy/buddy-session-length.integration.spec.ts` |
| **Settings & account** |
| Settings navigation | P1 | ✅ | ✅ | `e2e/auth/login.spec.ts`; `testHistoryAndSettingsNavigationSmoke` |
| Username inline edit / validation / conflict | P1 | ❌ | ✅ | iOS `testSettingsUsernameInlineEditSucceeds` et al. |
| Public board / aphorisms toggles | P2 | ❌ | ❌ | QA manual |
| Notifications subpage | P2 | ❌ | ⚠️ | Link exists; no E2E |
| App blocking / Screen Time gate | P2 | ➖ | ⚠️ | `testCompletedSessionUnlocksConfiguredAppGate` (settings smoke; no shield E2E) |
| Delete account flow | P2 | ❌ | ❌ | QA manual |
| **Layout / a11y (cross-cutting)** |
| Safe area / bottom nav overlap | P1 | ✅ | ✅ | `e2e/layout/safe-area.spec.ts`; `testPrimaryControlsVisibleAboveHomeIndicator` |
| Horizontal overflow / tap targets | P1 | ✅ | ⚠️ | `e2e/layout/overflow.spec.ts`, `login.spec.ts` |
| Mobile web 320–375px layout (#473) | P1 | ✅ | ➖ | `e2e/layout/issue-473-mobile-web-layout.spec.ts` |
| VoiceOver timer + primary button | P1 | ❌ | ✅ | `testVoiceOverLabelsForTimerAndPrimaryButton` |
| Cold-start auth latency bound | P1 | ❌ | ✅ | iOS smoke (`coldStartAuthCheckMs` ≤ 8000 ms) |

---

## Exclusions (justified)

### OAuth (Google / Apple, web + native)

Automated OAuth E2E requires live provider credentials, consent screens, redirect URI wiring, and simulator Keychain state. Policy defers real-provider auth to manual checklists (`docs/mobile-oauth-integration.md`, `ios/QA_CHECKLIST.md`). Route handlers remain covered by unit/integration tests; matrix marks OAuth as **out of scope** until a headless or stub-provider lane exists.

### Breath counting (full journey)

Breath counting is timing-sensitive (sub-second taps, phase animation, keyboard binding) and already covered by shared logic tests (`src/lib/breathCounting.test.ts`, `BreathCountingLogicTests.swift`). Web retains one **regression-only** edge case (`e2e/session/session-flow.spec.ts`: single-tap persist within first second); it is **not** tagged `@critical` and does not gate merge. iOS has no UI breath E2E by design.

### Other deferred areas (P2, no v1 gate)

- **Buddy room video** (Daily.co WebRTC) — manual QA only  
- **Push notification delivery** — cron/APNs; settings PATCH round-trip still TODO  
- **Screen Time shield enforcement** — settings gate smoke only (`348-phase2-spec`)  
- **Full-page visual snapshot gating** — `@visual` / Fastlane only (`e2e-policy.md` §9)  
- **iOS Friends tab** — web-only; parity gap (`ios/PARITY_CHECKLIST.md`)

---

## Gap-fill status (this issue)

| Gap | Action |
|-----|--------|
| PR `@smoke`/`@critical` covered only landing + auth shell | Tagged golden-path specs; added `signup` + `logout` area specs |
| Web logout untested | `e2e/settings/logout.spec.ts` |
| iOS quick minute / logout / journal+board tabs | New XCUITest methods + tab accessibility identifiers |
| Published matrix missing | This document |
| Locator contract (#152) | iOS `tab.journal`, `tab.board`, `journal.title`, `board.title` identifiers |

---

## Maintenance

When adding a user-facing journey:

1. Add a row here with risk tier and platform coverage.  
2. Tag web merge-blocking specs `@smoke` or `@critical` per [`e2e-policy.md`](./e2e-policy.md) §8.  
3. Wire new iOS tests into `scripts/e2e/run-ios-tests.sh` smoke or critical lanes.  
4. Prefer `auth.fixture.ts` + role/accessibility contracts over naked sleeps.
