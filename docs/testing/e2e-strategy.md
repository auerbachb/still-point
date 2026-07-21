# E2E testing strategy (#588)

Short strategy note for Still Point's CI e2e model — adapted from [auerbachb/skingod](https://github.com/auerbachb/skingod)'s e2e-flakiness / off-PR gating pattern ([#1402](https://github.com/auerbachb/skingod/issues/1402), [#1401](https://github.com/auerbachb/skingod/issues/1401)).

## Why e2e is off the PR critical path

Long-running e2e (Playwright web lanes, macOS XCTest) blocked every PR merge with high flake cost and low marginal safety versus running the same suites at **release** and **nightly**. Issue [#588](https://github.com/auerbachb/still-point/issues/588) moves comprehensive e2e off required PR checks while preserving coverage via gated + scheduled runs.

## Where e2e runs

| Suite | When | Blocks merge? | Workflow |
| --- | --- | --- | --- |
| **Web smoke + critical** | Nightly on `main` + `workflow_dispatch` | No | [e2e-web-nightly.yml](../../.github/workflows/e2e-web-nightly.yml) → [e2e-web.yml](../../.github/workflows/e2e-web.yml) |
| **Mobile-web matrix** | `release:ios` PR merge → TestFlight auto path | No (PR); **yes (release)** | [ios-testflight-auto.yml](../../.github/workflows/ios-testflight-auto.yml) → [e2e-mobile.yml](../../.github/workflows/e2e-mobile.yml) |
| **Native iOS smoke/critical** | `release:ios` PR merge → TestFlight auto path | No (PR); **yes (release)** | [ios-testflight-auto.yml](../../.github/workflows/ios-testflight-auto.yml) → [e2e-ios.yml](../../.github/workflows/e2e-ios.yml) |
| **PR advisory smoke** | Every PR | No (`continue-on-error`) | [e2e-smoke.yml](../../.github/workflows/e2e-smoke.yml) |
| **Coverage nudge** | Every PR | No (neutral check) | [e2e-coverage-nudge.yml](../../.github/workflows/e2e-coverage-nudge.yml) |

Manual `ios-v*-build*` tags ([ios-testflight.yml](../../.github/workflows/ios-testflight.yml)) intentionally **skip** e2e — break-glass when infra is down ([#494](https://github.com/auerbachb/still-point/issues/494)).

## What blocks PR merge (fast gate)

Required status checks on `main` — see [branch-protection.md](./branch-protection.md):

- `typecheck`, `unit-tests` (#434)
- `build` (Next clean build + design-token parity)
- `StillPointShared swift test` (#463 no-op pattern)
- `Info.plist in sync with project.yml` (#439, split to always-run workflow)

**Not required:** any `web-e2e-*` or `ios-e2e-*` job (#588 supersedes #537).

## Coverage accountability

- Journey matrix: [e2e-coverage-matrix.md](./e2e-coverage-matrix.md) (#497)
- Retry / flake policy: [e2e-policy.md](./e2e-policy.md)
- Nightly + release gates must still exercise P0 lanes — audit the matrix when moving specs between lanes.

## Local verification

```bash
# Fast policy (also part of web-build required check via design tokens)
npm run e2e:policy

# Full web lanes (what nightly runs)
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e:web:smoke
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e:web:critical

# iOS lanes (what release:ios gates)
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e:ios:smoke
E2E_BASE_URL=http://127.0.0.1:3000 npm run e2e:ios:critical
```

## Related issues

- [#588](https://github.com/auerbachb/still-point/issues/588) — this strategy
- [#537](https://github.com/auerbachb/still-point/issues/537) — superseded (would have required web e2e on PRs)
- [#494](https://github.com/auerbachb/still-point/issues/494) — mobile-web off PRs (prior SkinGod step)
- [#434](https://github.com/auerbachb/still-point/issues/434) / [#439](https://github.com/auerbachb/still-point/issues/439) — folded into branch protection sync
