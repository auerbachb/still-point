# Branch protection — required status checks (#537)

GitHub branch protection on `main` currently requires only:

- `typecheck`
- `StillPointShared swift test`

This document lists the additional checks from issue #537 that should block merges once a repo admin applies them. Related follow-ups: #434 (`unit-tests`), #439 (Info.plist sync).

## Checks to add

| Status check name | Workflow | Job | Why merge-blocking |
| --- | --- | --- | --- |
| `build` | [Web Build](../../.github/workflows/web-build.yml) | `build` | Runs `npm run build:verify` (repeatable clean Next builds) **and** `npm run e2e:policy:design-tokens` (iOS ↔ web design-token parity from #420/PR #491). |
| `web-e2e-smoke` | [E2E Web](../../.github/workflows/e2e-web.yml) | `web-e2e-smoke` | P0 smoke lane from the [#497 coverage matrix](./e2e-coverage-matrix.md). |
| `web-e2e-critical` | [E2E Web](../../.github/workflows/e2e-web.yml) | `web-e2e-critical` | P0 critical lane; complements smoke on auth/session/settings paths. |

Do **not** add `e2e-policy` as a separate required check — both web E2E jobs already `need: e2e-policy`, so a policy failure blocks smoke/critical automatically.

## Path-filter trap (#442 / #463)

Only require checks that report a result on **every** pull request. Required checks that are path-filtered away leave PRs stuck at `mergeStateStatus=BLOCKED` forever.

| Check | Runs on every PR? | Notes |
| --- | --- | --- |
| `build` | ✅ | `web-build.yml` has no path filter. |
| `web-e2e-smoke` / `web-e2e-critical` | ✅ | `e2e-web.yml` runs on all PRs. |
| `StillPointShared swift test` | ✅ | Uses a cheap ubuntu no-op when the package is unchanged (issue #463). |
| `web-e2e-auth-db` | ⚠️ optional | Skips when secrets are unset; keep **optional** until secrets are guaranteed. |
| `e2e-ios-*` | ❌ | Path-filtered to `ios/**`; do not require globally. |

## Apply (repo admin)

Dry-run the target list:

```bash
node scripts/ci/sync-main-required-checks.mjs --dry-run
```

Apply (requires `gh auth` with admin rights on the repo):

```bash
node scripts/ci/sync-main-required-checks.mjs --apply
```

The script merges the #537 checks with the existing required set (`typecheck`, `StillPointShared swift test`) instead of replacing unrelated settings. Review the printed JSON before `--apply`.

Manual alternative: **Settings → Branches → `main` → Require status checks** and add the three check names above alongside the existing two.

## Verification

After updating branch protection, open a no-op PR and confirm all five checks appear and complete:

1. `typecheck`
2. `StillPointShared swift test`
3. `build`
4. `web-e2e-smoke`
5. `web-e2e-critical`
