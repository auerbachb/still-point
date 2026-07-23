# iOS App Store submission and delegation runbook

End-to-end checklist for **submitting the Still Point iOS app** and delegating work across Engineering, Product / App Store, and Account Holder lanes. Canonical home for issue #164.

**Typical order:** upload a TestFlight build → validate in Connect → complete metadata and App Review materials → submit for review → track in #103.

For tag format, version bumps, and CI upload details, see [`ios/RELEASING.md`](../../ios/RELEASING.md). For positioning copy and parity notes, see [`ios/docs/app-store-metadata.md`](../../ios/docs/app-store-metadata.md). For what tooling automates vs what stays human-owned, see [Automation evidence log](./automation-evidence.md).

## Delegation split

| Lane | Owns |
|------|------|
| **Engineering** | Tags, GitHub Actions green, binary correctness, `ios/project.yml` version/build values, signing secrets, and making sure the shipped app matches review notes. |
| **Product / App Store** | Screenshots, copy, age rating, review notes + account-deletion recording, demo credentials, and release timing. |
| **Account Holder / Admin** | Apple Developer and App Store Connect agreements, tax, banking, and ASC-only metadata edits (see [#314](https://github.com/auerbachb/still-point/issues/314) subtitle). |

Record submission status, reviewer notes, build strings, and final outcome in ops tracker [#103](https://github.com/auerbachb/still-point/issues/103).

## TestFlight upload paths

Pick a path by intent. All TestFlight uploads share the reusable build workflow [`.github/workflows/ios-testflight-build.yml`](../../.github/workflows/ios-testflight-build.yml).

| Path | Trigger | Workflow | Use when |
|------|---------|----------|----------|
| **Auto TestFlight** (recommended) | Merge a PR to `main` with the **`release:ios`** label | [`.github/workflows/ios-testflight-auto.yml`](../../.github/workflows/ios-testflight-auto.yml) → `ios-testflight-build.yml` | You want the merged code on TestFlight; build number auto-increments. |
| **Manual TestFlight tag** (escape hatch) | Push `ios-v<marketing>-build<n>` (e.g. `ios-v1.0.3-build11`) | [`.github/workflows/ios-testflight.yml`](../../.github/workflows/ios-testflight.yml) → `ios-testflight-build.yml` | You need a specific commit/build by hand, or e2e infra blocked the auto path. |
| **App Store release** | Push strict semver `ios-vMAJOR.MINOR.PATCH` (no `-build`; must match `MARKETING_VERSION`) | [`.github/workflows/ios-app-store-release.yml`](../../.github/workflows/ios-app-store-release.yml) | Shipping metadata + binary via Fastlane after TestFlight validation. |

### Auto TestFlight (recommended)

1. Add the **`release:ios`** label to the PR you want to ship.
2. Merge to `main`. The auto workflow runs parallel e2e gates, increments `CURRENT_PROJECT_VERSION`, commits the bump with `[skip ci]`, tags `ios-v<MARKETING_VERSION>-build<n>`, and calls the reusable build/upload workflow.
3. Build appears in TestFlight ~15–30 minutes after the workflow finishes. Record processed build number and timestamp in [`ios/QA_CHECKLIST.md`](../../ios/QA_CHECKLIST.md).

`MARKETING_VERSION` is never auto-bumped — bump it in `ios/project.yml` in an ordinary PR when you want a new storefront version.

### Manual TestFlight tag (escape hatch)

1. Bump `CURRENT_PROJECT_VERSION` in [`ios/project.yml`](../../ios/project.yml) so it is strictly greater than the last upload.
2. Commit, tag, and push: `git tag ios-v1.0.3-build11 && git push origin ios-v1.0.3-build11`.
3. Confirm [Build & Upload to TestFlight](../../.github/workflows/ios-testflight.yml) is green and the build reaches **Ready to Test** in App Store Connect → **TestFlight**.

### First-time TestFlight setup

Before the first upload, the Account Holder should create an internal testing group in App Store Connect → **TestFlight** → **Internal Testing**, add testers, and enable **Automatic Distribution**. On the first build, answer the encryption questionnaire with **"None of the algorithms mentioned above"** — Still Point uses standard HTTPS only; `ITSAppUsesNonExemptEncryption` is `false` in `ios/project.yml`.

## Code signing (CI)

GitHub Actions holds distribution signing material as secrets (values never appear in logs or git). Both TestFlight and App Store release workflows import these on the macOS runner before `xcodebuild` / Fastlane `gym`.

| Secret | Used for |
|--------|----------|
| `BUILD_CERTIFICATE_BASE64` | Distribution certificate (`.p12`) |
| `P12_PASSWORD` | Certificate import password |
| `BUILD_PROVISION_PROFILE_BASE64` | App Store provisioning profile (main app) |
| `BUILD_PROVISION_PROFILE_EXTENSION_BASE64` | App extension profile (if applicable) |
| `BUILD_PROVISION_PROFILE_WIDGET_BASE64` | Widget extension profile (if applicable) |
| `APPSTORE_API_KEY_ID` | App Store Connect API key ID (`kid`) |
| `APPSTORE_API_ISSUER_ID` | App Store Connect API issuer |
| `APPSTORE_API_PRIVATE_KEY` | API private key (full `.p8` contents) |

**Bundle ID:** `com.brettonauerbach.stillpoint` — certificate and provisioning profile must match.

**Troubleshooting:**

- **Signing error in CI:** verify certificate validity and that the provisioning profile bundle ID matches.
- **Upload authentication error:** regenerate the App Store Connect API key and update GitHub secrets.
- **Build number conflict:** `CURRENT_PROJECT_VERSION` must be unique per upload; re-uploads need a new TestFlight tag and incremented build number.
- **`FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`:** Account Holder must clear Agreements, Tax, and Banking in Apple Developer / App Store Connect before uploads succeed.

The App Store release workflow maps `APPSTORE_*` secrets to Fastlane's `APP_STORE_CONNECT_API_*` environment names at runtime (see [`.github/workflows/ios-app-store-release.yml`](../../.github/workflows/ios-app-store-release.yml)).

## App Store Connect metadata

**Canonical repo strings** for English (U.S.) live under [`ios/fastlane/metadata/en-US/`](../../ios/fastlane/metadata/en-US/) and are uploaded by `deliver` on the App Store release path. Reconcile App Store Connect with those files before submission.

| Field | Canonical value |
|--------|------------------|
| **Name** | Still Point |
| **Subtitle** | `Meditate one minute at a time` (30 characters max; spell **meditate**, never `medite`) |
| **Privacy Policy URL** | `https://still-point.me/privacy` |

### Subtitle typo — ASC-only fix ([#314](https://github.com/auerbachb/still-point/issues/314))

The repo-side subtitle is correct in [`ios/fastlane/metadata/en-US/subtitle.txt`](../../ios/fastlane/metadata/en-US/subtitle.txt) and [`ios/docs/app-store-metadata.md`](../../ios/docs/app-store-metadata.md). If the live App Store Connect subtitle still shows **"medite"**, the **Account Holder** must fix it directly in App Store Connect — it cannot be changed from the repo alone.

While in ASC, also scan **Description**, **Keywords**, and **What's New** for the same typo. Track completion in #314.

### Screenshots

Regenerate candidates with [`ios-screenshots.yml`](../../.github/workflows/ios-screenshots.yml) (manual `workflow_dispatch`) or locally via `bundle exec fastlane screenshots`. Curate into [`ios/screenshots/selected/`](../../ios/screenshots/selected/) and upload with `bundle exec fastlane upload_app_store_screenshots`. See the *Regenerate candidate App Store screenshots* section in [`ios/RELEASING.md`](../../ios/RELEASING.md).

## AI-assisted dry run

Before a live submission, generate the issue #242 evidence package:

```bash
npm run ios:app-store:dry-run
```

The command reads `README.md`, `ios/RELEASING.md`, this runbook, `.github/workflows/ios-testflight.yml`, `.github/workflows/ios-app-store-release.yml`, `ios/PARITY_CHECKLIST.md`, `ios/QA_CHECKLIST.md`, and `ios/project.yml`. It writes `artifacts/ios-app-store-dry-run/summary.json`, `summary.md`, and `automation.log` with:

- the intended `ios-v*` tag, marketing version, build number, bundle ID, workflow trigger, and release artifact placeholders;
- a 38-item issue #242 checklist map across phases A–F, App Store Connect API readiness, submission execution, review follow-up, proof, and definition-of-done items;
- App Store Connect API fallback paths and explicit human-owned gates.

Set `APPSTORE_APP_ID`, `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID`, and `APPSTORE_API_PRIVATE_KEY` to let the dry run query App Store Connect builds and version records. Add `-- --require-live` when a real submission must fail fast if live API validation cannot run. The script does not submit for review; submission remains blocked until the generated human gates are approved.

## Release checklist (Phases A–F)

Assumes a **TestFlight build is already uploaded** and agreements are clear unless noted.

### Phase A — Preconditions before submission

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 1 | [ ] **Apple Developer + App Store Connect:** all **Agreements, Tax, and Banking** are signed with no **Action required** items. | Account Holder / Admin | Screenshot or written confirmation. Uploads fail with `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` until clean. |
| 2 | [ ] **GitHub Actions:** latest **Build & Upload to TestFlight** workflow for the intended `ios-v*` tag is green. | Engineering | Link the successful run for [`.github/workflows/ios-testflight.yml`](../../.github/workflows/ios-testflight.yml) or [`.github/workflows/ios-testflight-auto.yml`](../../.github/workflows/ios-testflight-auto.yml). |
| 3 | [ ] **TestFlight:** intended build is visible in App Store Connect → **TestFlight** and is not stuck **Processing** or marked **Invalid**. | Engineering | Capture build status and processing timestamp. |
| 4 | [ ] **Version / build:** `ios/project.yml` `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` match the intended submission; build number is strictly greater than any prior upload. | Engineering | Paste version/build values; compare against prior Connect uploads. |
| 5 | [ ] **Release-readiness artifacts:** [`ios/PARITY_CHECKLIST.md`](../../ios/PARITY_CHECKLIST.md) and [`ios/QA_CHECKLIST.md`](../../ios/QA_CHECKLIST.md) signed off for App Store path (required by `ios-app-store-release.yml`). | Engineering + Product | Required checkboxes checked before App Store tag push. |

### Phase B — App Store version record

In App Store Connect, open the app and go to **Distribution** / **App Store** for the target version.

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 6 | [ ] **Create or open** the App Store version (e.g. `1.0.0`). | Product / App Store | Target version exists in App Store Connect. |
| 7 | [ ] **Attach the build:** select the TestFlight build intended for this version. | Product / App Store + Engineering | Build number matches `CURRENT_PROJECT_VERSION`. |
| 8 | [ ] **Screenshots:** all required iPhone sizes present; iPad sizes if required. | Product / App Store | No required-size warnings. |
| 9 | [ ] **Metadata:** name, subtitle, description, keywords, support URL, marketing URL complete. Subtitle spells **meditate** ([#314](https://github.com/auerbachb/still-point/issues/314)). | Product / App Store | No missing required metadata fields. |
| 10 | [ ] **Privacy Policy URL:** `https://still-point.me/privacy`. | Product / App Store | URL matches project docs. |
| 11 | [ ] **Age rating** questionnaire complete. | Product / App Store | Age rating section has no incomplete status. |
| 12 | [ ] **Export compliance** complete or covered in app metadata. | Product / App Store + Engineering | Export compliance accepted. App sets `ITSAppUsesNonExemptEncryption: false` in `ios/project.yml`. |
| 13 | [ ] **App Review contact** and phone present if required. | Product / App Store | Review contact section complete. |

### Phase C — App Review information

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 14 | [ ] **Notes for reviewer:** short and factual — how to sign in and exact account deletion path. Mention **Guideline 5.1.1(v)** if responding to that rejection thread. | Product / App Store + Engineering | Path matches [`ios/RELEASING.md`](../../ios/RELEASING.md) and the submitted binary. |
| 15 | [ ] **Attachment:** screen recording from a physical iPhone — sign-in → **Settings** → **Delete account** → confirm → signed out. | Product / App Store | Recording attached and matches the binary. |
| 16 | [ ] **Demo credentials:** private review-field credentials or reliable signup path documented. | Product / App Store | Private fields populated or signup instructions clear. |

### Phase D — Submit

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 17 | [ ] Version page has the intended build attached; all Connect warnings/blockers resolved. | Product / App Store + Engineering | Re-open version page immediately before submission. |
| 18 | [ ] Click **Submit for Review** or **Add for Review** (wording varies for first submit vs update). | Product / App Store | Capture submission timestamp in #103. |
| 19 | [ ] Monitor status until **In Review** → **Approved** or **Rejected**. | Product / App Store | Post daily status in #103 while waiting. |

**Ops tracker:** [#103](https://github.com/auerbachb/still-point/issues/103) — paste reviewer notes, build strings, daily status.

### Phase E — If rejected

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 20 | [ ] Copy reviewer notes verbatim into #103; link engineering issues per finding (keep implementation discussion out of #103). | Product / App Store | Exact reviewer language and follow-up issue links in #103. |
| 21 | [ ] Fix code/config, bump iOS build, push new `ios-v*-build*` tag or re-run CI per [`ios/RELEASING.md`](../../ios/RELEASING.md). | Engineering | New build number strictly incremented; TestFlight upload green. |
| 22 | [ ] Attach new build; update review notes and recording if the flow changed; resubmit. | Product / App Store + Engineering | Version page references replacement build and updated materials. |

### Phase F — If approved

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 23 | [ ] Choose release strategy: manual, automatic, or phased rollout. | Product / App Store | Strategy selected in App Store Connect. |
| 24 | [ ] Final #103 log entry — date, version + build, outcome (shipped / held / phased). | Product / App Store | #103 has final release outcome. |
| 25 | [ ] Close #103 when submission tracking is complete per its definition of done. | Product / App Store | #103 closed only after lifecycle complete. |

## Reviewer notes template

```text
Thank you for reviewing Still Point.

Sign in using the demo credentials in the private review fields, or create a new account from the sign-in screen.

Account deletion path for Guideline 5.1.1(v):
1. Open Settings.
2. Tap Delete Account.
3. Tap Continue on the first prompt.
4. Tap Delete Account on the final confirmation alert.
5. Confirm the app returns to the signed-out screen.
```

## GitHub Actions workflows (reference)

| Workflow | File | Trigger |
|----------|------|---------|
| Auto TestFlight on merge | [`.github/workflows/ios-testflight-auto.yml`](../../.github/workflows/ios-testflight-auto.yml) | PR merged to `main` with `release:ios` label |
| Manual TestFlight tag | [`.github/workflows/ios-testflight.yml`](../../.github/workflows/ios-testflight.yml) | Push `ios-v*-build*` tag |
| Reusable build + upload | [`.github/workflows/ios-testflight-build.yml`](../../.github/workflows/ios-testflight-build.yml) | Called by auto and manual TestFlight paths |
| App Store release (Fastlane) | [`.github/workflows/ios-app-store-release.yml`](../../.github/workflows/ios-app-store-release.yml) | Push `ios-vMAJOR.MINOR.PATCH` (no `-build`) |
| Screenshot candidates | [`.github/workflows/ios-screenshots.yml`](../../.github/workflows/ios-screenshots.yml) | Manual `workflow_dispatch` |
| iOS shared tests | [`.github/workflows/ios-shared-tests.yml`](../../.github/workflows/ios-shared-tests.yml) | PR / push (unit tests) |

**Submit for review in CI:** `ios-app-store-release.yml` leaves `SUBMIT_FOR_REVIEW` unset, so `deliver` uses `submit_for_review: false` (upload only). Issue [#296](https://github.com/auerbachb/still-point/issues/296) can enable programmatic submission by setting `SUBMIT_FOR_REVIEW=1` when a release owner approves.

## Related links

- Ops / submission log: [#103](https://github.com/auerbachb/still-point/issues/103)
- Submit / archive checklist (historical): [#37](https://github.com/auerbachb/still-point/issues/37)
- ASC subtitle fix (Account Holder): [#314](https://github.com/auerbachb/still-point/issues/314)
- Release / tag / build docs: [`ios/RELEASING.md`](../../ios/RELEASING.md)
- Metadata positioning: [`ios/docs/app-store-metadata.md`](../../ios/docs/app-store-metadata.md)
- Automation evidence: [`docs/operations/automation-evidence.md`](./automation-evidence.md)
- App Store Connect submission URL pattern: `https://appstoreconnect.apple.com/apps/<app-id>/distribution/reviewsubmissions/details/<submission-id>`
