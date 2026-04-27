# iOS Release Candidate QA Checklist (Issue #210)

Release candidate: 1.0.3 (8)
Last updated: 2026-04-25
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

## 2) Platform checks

| Check | Status | Notes |
|---|---|---|
| Cold launch stability | ✅ Pass | No crash on first launch with signed-in user. |
| Foreground/background resume | ✅ Pass | Session state is preserved on short background transitions. |
| Network offline handling | ✅ Pass | API errors surface user-readable messaging for critical paths. |
| Light/dark appearance sanity | ✅ Pass | Core screens remain legible and themed correctly. |

## 3) Release metadata + submission readiness

- [x] `ios/project.yml` versioning finalized: `MARKETING_VERSION = 1.0.3`, `CURRENT_PROJECT_VERSION = 8`.
- [x] App Store release notes finalized for this build (see `ios/RELEASING.md`).
- [x] App Store metadata checklist finalized (privacy policy URL, support URL, account deletion review notes).
- [ ] Build submitted to App Store review in App Store Connect.
  - Owner: iOS release DRI
  - Target date: 2026-04-24
  - Completion evidence: attach App Store Connect submission timestamp and build number in PR comment.

## Release gate decision (Issue #210)

- [x] Regression/QA pass for release candidate is completed.
- [x] App Store metadata/versioning/release notes are finalized.
- [ ] Updated iOS build is submitted to App Store by end of week.
