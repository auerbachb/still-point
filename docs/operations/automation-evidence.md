# iOS App Store automation — automated vs manual (issue #242)

This log complements the machine-readable output from `npm run ios:app-store:dry-run` (`artifacts/ios-app-store-dry-run/summary.json`). It records what the repository automates today versus steps that remain human-owned.

## Preconditions (human, one-time or rare)

| Step | Owner | Notes |
|------|--------|------|
| Create App Store Connect API key (`.p8`), **never commit the key** | Account Holder / Admin | One-time setup; this repo already stores `APPSTORE_API_*` in GitHub Actions secrets (rotate in ASC + GitHub if the key is revoked). |
| Confirm `gh secret list` shows required names (values are never visible) | Release owner | Cannot be automated inside CI without elevated token scope. |
| Distribution certificate + provisioning profile secrets | Engineering | `BUILD_CERTIFICATE_BASE64`, `P12_PASSWORD`, `BUILD_PROVISION_PROFILE_BASE64`. |
| Apple Agreements, Tax, Banking | Account Holder / Admin | Not reliably exposed via public API; uploads can fail until clear. |

## Automated in CI (after secrets exist)

| Capability | Mechanism | Workflow |
|------------|-----------|----------|
| Release-config UI smoke | `npm run e2e:ios:smoke` | TestFlight + App Store release |
| Release-readiness checklist gate | `grep` on `PARITY_CHECKLIST.md` / `QA_CHECKLIST.md` | Both |
| Machine-readable preflight | `npm run ios:app-store:dry-run` | Both |
| Archive + upload binary to App Store Connect / TestFlight | `xcodebuild -exportArchive` with API key | TestFlight (`ios-testflight.yml`) |
| Preflight + archive + metadata + binary via Fastlane | `bundle exec fastlane release` (`gym`, `deliver`) | App Store release (`ios-app-store-release.yml`); `submit_for_review` is false unless `SUBMIT_FOR_REVIEW=1` |

## Automated locally or on a Mac runner (Fastlane)

| Lane (`ios/` directory) | Purpose |
|-------------------------|---------|
| `bundle exec fastlane preflight` | Runs the Node dry-run (same as `npm run ios:app-store:dry-run` from repo root). |
| `bundle exec fastlane build` | `gym` → IPA (no upload). |
| `bundle exec fastlane beta` | `gym` + `pilot` (TestFlight upload). |
| `bundle exec fastlane metadata_only` | `deliver` metadata only (no binary). |
| `bundle exec fastlane release` | Preflight (unless `SKIP_PREFLIGHT=1`) + `gym` + `deliver` (binary + metadata). |

**Submit for review:** CI does **not** set `SUBMIT_FOR_REVIEW`, so `deliver` runs with `submit_for_review: false` (upload-only; issue #242 default). For a future live submission (#296+), set `SUBMIT_FOR_REVIEW=1` in the workflow when a release owner approves. Optional: `AUTOMATIC_RELEASE=1` (only applied when submitting).

## Explicit human gates (not fully automatable)

| Gate | Reason |
|------|--------|
| Release timing (manual vs automatic vs phased) after approval | Business / product decision. |
| Age rating questionnaire changes | Compliance accountability. |
| Screenshot / app preview assets | Require approved creative; automation hooks in #325. |
| Demo credentials in private review fields | Human-provided secrets. |
| Physical-device account-deletion screen recording for review | Asset capture + verification. |
| Rejection triage and engineering issue breakdown | Human judgment before filing work. |
| Closing the ops tracking issue | After final outcome is known. |

## Evidence for a given run

- **Dry run / preflight:** `artifacts/ios-app-store-dry-run/` (from `npm run ios:app-store:dry-run` or the `preflight` lane).
- **CI:** GitHub Actions run logs and uploaded artifacts for `ios-testflight.yml` and `ios-app-store-release.yml`.

Last updated: 2026-05-01 (issue #242 harness).
