# Branch protection — required status checks (#588)

GitHub branch protection on `main` currently requires only:

- `typecheck`
- `StillPointShared swift test`

This document lists the **fast PR merge gate** from issue #588, which **folds** #434 (`unit-tests`) and #439 (`Info.plist in sync with project.yml`) into a **single admin update**. It **supersedes #537** (which would have required `web-e2e-smoke` / `web-e2e-critical` on every PR).

Comprehensive e2e (web + native iOS) runs **nightly** and on the **iOS TestFlight release path** instead — see [e2e-strategy.md](./e2e-strategy.md).

## Checks to require (fast merge gate)

| Status check name | Workflow | Job | Why merge-blocking |
| --- | --- | --- | --- |
| `typecheck` | [Unit Tests](../../.github/workflows/unit-tests.yml) | `typecheck` | Full-project `tsc --noEmit` (#396). |
| `unit-tests` | [Unit Tests](../../.github/workflows/unit-tests.yml) | `unit-tests` | Jest/unit suite — #434. |
| `build` | [Web Build](../../.github/workflows/web-build.yml) | `build` | `npm run build:verify` + design-token parity (#420). |
| `StillPointShared swift test` | [iOS Shared Unit Tests](../../.github/workflows/ios-shared-tests.yml) | `swift-test` | Shared Swift parity; ubuntu no-op when unchanged (#463). |
| `Info.plist in sync with project.yml` | [Info.plist sync](../../.github/workflows/infoplist-sync.yml) | `infoplist-sync` | XcodeGen drift guard — #439; split out of path-filtered e2e-ios (#588). |

## Checks to **not** require (advisory / off-PR)

| Check | Runs when | Notes |
| --- | --- | --- |
| `web-e2e-smoke` / `web-e2e-critical` | Nightly + `workflow_dispatch` | Full suite via [e2e-web.yml](../../.github/workflows/e2e-web.yml) / [e2e-web-nightly.yml](../../.github/workflows/e2e-web-nightly.yml). **Do not require on PRs** (#588). |
| `ios-e2e-smoke` / `ios-e2e-critical` | `release:ios` merge gate | [e2e-ios.yml](../../.github/workflows/e2e-ios.yml) via [ios-testflight-auto.yml](../../.github/workflows/ios-testflight-auto.yml). |
| `pr-e2e-smoke (advisory)` | Every PR (optional) | [e2e-smoke.yml](../../.github/workflows/e2e-smoke.yml) — `continue-on-error: true`. |
| `e2e coverage nudge (advisory)` | Every PR (neutral) | [e2e-coverage-nudge.yml](../../.github/workflows/e2e-coverage-nudge.yml). |
| `web-e2e-auth-db` | Nightly / dispatch | Skips when secrets unset; keep optional. |

If #537 checks were previously applied, remove `web-e2e-smoke`, `web-e2e-critical`, and `e2e-policy` when syncing (#588).

## Path-filter trap (#442 / #463 / #588)

Only require checks that report a result on **every** pull request. Required checks that are path-filtered away leave PRs stuck at `mergeStateStatus=BLOCKED` forever.

| Check | Runs on every PR? | Notes |
| --- | --- | --- |
| `unit-tests` / `typecheck` / `build` | ✅ | No path filters. |
| `StillPointShared swift test` | ✅ | Ubuntu no-op when package unchanged (#463). |
| `Info.plist in sync with project.yml` | ✅ | Ubuntu no-op when plist inputs unchanged (#588 / #439). |
| `web-e2e-*` / `ios-e2e-*` | ❌ | Off PR path — do not require globally. |

## Apply (repo admin — requires confirmation)

Dry-run the target list:

```bash
node scripts/ci/sync-main-required-checks.mjs --dry-run
```

Apply (requires `gh auth` with admin rights on the repo):

```bash
node scripts/ci/sync-main-required-checks.mjs --apply
```

The script merges the #588 checks with the existing required set, removes deprecated e2e checks if present, and preserves unrelated settings (e.g. Vercel app checks). Review the printed list before `--apply`.

Manual alternative: **Settings → Branches → `main` → Require status checks** — add the five fast checks above; remove any e2e checks; keep existing Vercel/CodeRabbit checks.

## Verification

After updating branch protection, open a no-op PR and confirm all five fast checks appear and complete:

1. `typecheck`
2. `unit-tests`
3. `build`
4. `StillPointShared swift test`
5. `Info.plist in sync with project.yml`

Confirm full e2e workflows (`e2e-web`, `e2e-ios`) do **not** run on the PR, while advisory lanes (`pr-e2e-smoke`, coverage nudge) may appear without blocking merge.
