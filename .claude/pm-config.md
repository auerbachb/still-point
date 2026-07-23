# PM Config — still-point

Bootstrapped 2026-07-22 by `/pm` (config was missing). Refresh via `/pm-update`; set objectives via `/pm-okr`.

## Role

Solo founder-owner (auerbachb) building Still Point — a meditation/mindfulness timer app (web + iOS). AI-agent-heavy workflow: issues planned with CodeRabbit, implemented by Claude/Cursor agents, reviewed by a multi-bot fleet, squash-merged with human authorization.

## Infrastructure

- **Web:** Next.js (App Router) + React, next-auth, Jotai, web-push; buddy video via Daily (`@daily-co`). Deployed on Vercel — auto-deploy on every merge to main, preview per PR (Preview has `NODE_ENV=production`; gate on `VERCEL_ENV`).
- **DB:** Neon Postgres (project `noisy-cell-87641627` prod + preview branch) via Drizzle ORM; `drizzle/*.sql` auto-applied on deploy via `scripts/apply-migrations.ts` in the Vercel buildCommand.
- **iOS:** Native SwiftUI app in `ios/` (XcodeGen `project.yml`, Info.plist sync-checked in CI); shared Swift package `ios/StillPointShared` (`swift test` in CI, works locally). TestFlight via GitHub Actions — auto-build only on merged PR labeled `release:ios` or manual `ios-v*-build*` tag; clean semver tag = App Store submission. Current: build 17 (uploaded 2026-07-21).
- **CI (PR path):** unit-tests (vitest), web-build, infoplist-sync, StillPointShared swift test (path-filtered **required** check — blocks unrelated PRs when it never runs), design-token gate. E2E (Playwright web + iOS XCUITest) moved OFF the PR path to nightly + release runs (#588 / PR #595).
- **Reviews:** CodeRabbit (issue plans via `cr-plan-on-issue.yml` + PR reviews) and CodeAnt (approves once its threads resolve) are primary; BugBot quota-dead (2026-07); Greptile last resort.

## Architecture

- Dual-platform, two codebases: `src/` (Next.js web) and `ios/` (SwiftUI). No shared code across platforms — features port manually. `ios/PARITY_CHECKLIST.md` is the parity ledger; `ios/QA_CHECKLIST.md` the QA ledger.
- `scripts/` holds CI/tooling (e2e harness, `ci/sync-main-required-checks.mjs`, App Store dry-run); `e2e/` Playwright suites; `drizzle/` migrations.
- Sessions/streaks/ratings data model in `src/db/schema.ts`; iOS consumes the same Next.js API via DTOs in StillPointShared.

## OKRs

No OKRs set — run `/pm-okr` to set objectives. `/pm` ranking falls back to repo signals.

## Team

- **auerbachb** — owner, sole maintainer and merge authority.
- **paulkathat-lmc** — occasional delegate (docs; assigned #164 since 2026-04).
- Bots: `coderabbitai[bot]`, `codeant-ai[bot]`, `cursor[bot]`, `graphite-app[bot]`, `greptile-apps[bot]`.

## Notes

- Backlog convention: `long-term` and `human-work` labels mark parked / non-agent work (~23 of 37 open issues); rank agent work from the remainder.
- iOS build-only compile bugs surface late: no per-PR archive CI (cost decision), and local `xcodebuild` can't parse the project (objectVersion 77) — only `ios/StillPointShared` `swift test` validates locally.
- Web is the feature vanguard; iOS follows via parity issues (the #519–#529 batch from the 2026-07-02 codebase review is nearly done — #521/#526/#529 remain).
- 2026-07-23: standing merge authorization granted in chat (see session records); the #519–#529 parity batch and #616 all shipped 2026-07-22/23.

## Dependency Rules

- #472 (mood before/after redesign) shares the CompletionView surface with #521 (ratings port) — decide #472 first or accept rework on #521.
- #599 (Vapi MI voice calls) is blocked on human Vapi account provisioning (API key, outbound number, assistant config).
- #316 (E2E secrets) unblocks credentialed nightly mobile-web e2e.

## Workflow Rules

- Issue → CR plan merged into body (`## Implementation Plan` gate) → worktree branch `issue-N-*` → PR with `Closes #N` + Test plan checkboxes → dual local CLI review → bot review chain → squash merge (explicit authorization required).
- Never work on main. iOS e2e single-test flakes on auth/launch: rerun once (infrastructure, not code).
