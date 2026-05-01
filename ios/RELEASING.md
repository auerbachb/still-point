# Releasing Still Point for iOS

## Release-readiness artifacts (Issue #210)

Treat these files as required merge artifacts for iOS release candidates:

- `ios/PARITY_CHECKLIST.md` - feature parity status vs web, including deferred gaps with owner/date.
- `ios/QA_CHECKLIST.md` - regression/QA sign-off, release metadata completion, and submission evidence.

## Prerequisites

The following GitHub Actions **secrets** are used by the iOS workflows (already configured for this repo; do not rename). Values never appear in logs or git.

| Secret | Used for |
|--------|----------|
| `BUILD_CERTIFICATE_BASE64` | Distribution signing (`xcodebuild` / `gym`) |
| `P12_PASSWORD` | `.p12` import password |
| `BUILD_PROVISION_PROFILE_BASE64` | App Store provisioning profile |
| `APPSTORE_API_KEY_ID` | App Store Connect API (JWT `kid`) |
| `APPSTORE_API_ISSUER_ID` | App Store Connect API issuer |
| `APPSTORE_API_PRIVATE_KEY` | API private key (full `.p8` contents as a secret; never commit the file) |

The App Store release workflow maps these to Fastlane’s standard `APP_STORE_CONNECT_API_*` environment names at runtime (see `.github/workflows/ios-app-store-release.yml`).

## First-time setup

Before your first TestFlight release, configure a tester group and handle encryption compliance:

1. Open [App Store Connect](https://appstoreconnect.apple.com) and navigate to your app.
2. Go to `TestFlight` -> `Internal Testing` and click the `+` button to create a new group (e.g., "Internal Testers").
3. Add testers to the group by clicking `Add Testers` and entering their Apple ID email addresses.
4. Under the group's `Automatic Distribution` setting, enable it so new builds are distributed to the group automatically.
5. On the first build upload, App Store Connect presents an encryption compliance questionnaire. Select **"None of the algorithms mentioned above"** - Still Point only uses standard HTTPS via `URLSession`, which is exempt.

## Releasing to TestFlight

1. Complete and commit `ios/PARITY_CHECKLIST.md` and `ios/QA_CHECKLIST.md`.
2. Update the version in `ios/project.yml`:
   ```yaml
   MARKETING_VERSION: "1.0.3"
   CURRENT_PROJECT_VERSION: 10
   ```
3. Commit release artifacts + version bump:
   ```bash
   git add ios/project.yml ios/PARITY_CHECKLIST.md ios/QA_CHECKLIST.md ios/RELEASING.md
   git commit -m "Finalize iOS 1.0.3 (build 10) release readiness"
   ```
4. Tag and push using the **TestFlight** tag pattern (`ios-v{version}-build{number}`):
   ```bash
   git tag ios-v1.0.3-build10
   git push origin ios-v1.0.3-build10
   ```
5. The [Build & Upload to TestFlight](../.github/workflows/ios-testflight.yml) workflow (`ios-v*-build*` tags) builds and uploads to TestFlight automatically.
6. After Apple processes the build (~15 minutes), it appears in the TestFlight app.
7. Record the processed build number and processing timestamp in `ios/QA_CHECKLIST.md`.
8. Before App Store submission, run the automation dry run and save its artifact:
   ```bash
   npm run ios:app-store:dry-run
   ```
   The report in `artifacts/ios-app-store-dry-run/` confirms source-of-truth
   docs, release-readiness checklists, workflow secret references, version/build
   values, App Store Connect API readiness, human-owned gates, and fallback
   paths. For live App Store Connect build/version validation, provide
   `APPSTORE_APP_ID` plus the App Store Connect API key environment variables
   and rerun with `-- --require-live`.

## App Store release (tag → Fastlane)

When you are ready to push **metadata + binary** to App Store Connect for the version in `ios/project.yml` (typically after TestFlight validation):

1. Ensure `MARKETING_VERSION` in `ios/project.yml` matches the storefront version you intend to ship.
2. Use a **strict semver tag** (no `-build` suffix): `ios-vMAJOR.MINOR.PATCH` must equal `MARKETING_VERSION`, e.g. `ios-v1.0.3`.
3. Push the tag:
   ```bash
   git tag ios-v1.0.3
   git push origin ios-v1.0.3
   ```
4. [iOS App Store release (Fastlane)](../.github/workflows/ios-app-store-release.yml) runs: smoke tests, checklist gate, `npm run ios:app-store:dry-run`, then `bundle exec fastlane release` (preflight → `gym` → `deliver`).

**Submit for review:** CI sets `DELIVER_SKIP_SUBMISSION=1` so `deliver` uploads the IPA and metadata but does **not** submit the version for review (harness / #242 default). Issue **#296** can turn on full submission by clearing that guard and following the release-owner checklist.

Optional after #296: set `DELIVER_SKIP_SUBMISSION=0` and `SUBMIT_FOR_REVIEW=1` when programmatic submission is explicitly approved; optional `AUTOMATIC_RELEASE=1`.

### Fastlane (local or debugging)

Bundler + Fastlane live under `ios/`:

```bash
cd ios
bundle install
bundle exec fastlane preflight   # same as npm dry-run from repo root
bundle exec fastlane build       # gym only
bundle exec fastlane metadata_only
bundle exec fastlane release     # preflight + gym + deliver
```

Lanes are defined in [`fastlane/Fastfile`](./fastlane/Fastfile). App identifier and team are in [`fastlane/Appfile`](./fastlane/Appfile). Default `deliver` options are in [`fastlane/Deliverfile`](./fastlane/Deliverfile). **Localized copy** for `en-US` is under [`fastlane/metadata/en-US/`](./fastlane/metadata/en-US/) (canonical for `deliver`).

## App Store submission handoff

After the intended TestFlight build is processed and valid, use the delegate-ready [iOS App Store submission runbook](../docs/operations/ios-app-store-submission.md) to complete App Store Connect setup, reviewer notes, submission, rejection handling, approval, and release tracking. For what is automated vs manual in tooling, see [Automation evidence log](../docs/operations/automation-evidence.md).

## Version numbering

- `MARKETING_VERSION` - user-facing version (e.g., `1.0.0`, `1.0.3`).
- `CURRENT_PROJECT_VERSION` - build number; increment every upload (`1`, `2`, `3`, ...).
- **TestFlight:** push a tag matching `ios-v*-build*` (e.g. `ios-v1.0.3-build10`) to trigger [`.github/workflows/ios-testflight.yml`](../.github/workflows/ios-testflight.yml).
- **App Store automation:** push a strict semver tag `ios-vMAJOR.MINOR.PATCH` that **equals** `MARKETING_VERSION` to trigger [`.github/workflows/ios-app-store-release.yml`](../.github/workflows/ios-app-store-release.yml).
- Uploaded app version is controlled by `ios/project.yml`, not the tag string (except the App Store workflow enforces tag ↔ `MARKETING_VERSION` match).
- Re-uploads for the same marketing version require a new TestFlight tag and incremented build number, e.g. `ios-v<marketing-version>-build<next-build>`.

## Regenerate candidate App Store screenshots (Issue #325)

The repo ships a **wide candidate set** (Fastlane snapshot) under `ios/screenshots/candidates/` when you run the lane locally or via GitHub Actions. Those files are **gitignored**; you **curate** into `ios/screenshots/selected/` and commit only the chosen PNGs.

### One-time setup (Mac)

1. Install Xcode and command-line tools.
2. From repo root: `cd ios && brew install xcodegen` (CI uses the same).
3. `cd ios && bundle install` (installs Fastlane from `ios/Gemfile`).
4. Edit `ios/fastlane/Snapfile` so every `devices([...])` entry matches a name from `xcrun simctl list devices available` on your machine (6.7", 6.5", 5.5", iPad Pro 12.9" class).

Optional: export `SNAPSHOT_DEVICES='iPhone 17 Pro Max,iPhone 17 Pro,iPhone 11 Pro Max,iPhone 8 Plus,iPad Pro 13-inch (M5)'` before `fastlane screenshots` to override the Snapfile list without editing files.

### Regenerate candidates

```bash
cd ios
xcodegen generate
bundle exec fastlane screenshots
```

This runs `StillPointAppUITests/SnapshotTests` with `SP_UI_TEST_SNAPSHOT_SEED=1` (deterministic in-app data, no backend). The lane writes PNGs to `ios/screenshots/candidates/` and builds `ios/screenshots/candidates/index.html` for side-by-side preview.

### Curate and upload (selected set only)

1. Pick up to **10 screenshots per device class** for App Store Connect.
2. Copy chosen files into `ios/screenshots/selected/` using Fastlane’s folder layout, for example:

   `ios/screenshots/selected/en-US/iPhone 17 Pro Max-01-home.png`

   Use **numeric prefixes** in the filename (`01-`, `02-`, …) so ordering in Finder matches upload order (deliver preserves lexicographic order per device folder).

3. Commit **only** `ios/screenshots/selected/` (not `candidates/`).

4. Upload with API key env vars (same secrets as CI — never commit the `.p8`):

   ```bash
   cd ios
   export APPSTORE_API_KEY_ID=...
   export APPSTORE_API_ISSUER_ID=...
   export APPSTORE_API_PRIVATE_KEY="$(cat AuthKey_xxx.p8)"
   bundle exec fastlane upload_app_store_screenshots
   ```

   Alias: `bundle exec fastlane release` (screenshots-only; does not submit binary).

### CI

Workflow [`.github/workflows/ios-screenshots.yml`](../.github/workflows/ios-screenshots.yml) is **manual** (`workflow_dispatch`). It runs `fastlane screenshots`, resolves simulator names for the runner’s Xcode, and uploads `ios/screenshots/candidates/**` as an artifact for review.

## App Store metadata and release notes checklist

Canonical **deliverable** App Store Connect strings for English (U.S.) live in [`fastlane/metadata/en-US/`](./fastlane/metadata/en-US/). Positioning context and parity notes remain in [`ios/docs/app-store-metadata.md`](./docs/app-store-metadata.md). Reconcile App Store Connect with the `fastlane/metadata` files when preparing a submission.

Before "Add for Review," verify the following in App Store Connect:

- [ ] Version record created for current `MARKETING_VERSION`.
- [ ] Build selected matches current `CURRENT_PROJECT_VERSION`.
- [ ] Description reflects latest shipping behavior.
- [ ] **Privacy Policy URL** is `https://still-point.me/privacy`.
- [ ] Support URL is configured and reachable.
- [ ] Screenshots are current for all required device classes.
- [ ] App Review notes include account deletion walkthrough.

Release notes template for iOS 1.0.3:

```text
Still Point 1.0.3 improves session reliability and social sitting stability.

- Refines buddy session join/start/leave flows for more reliable partner synchronization.
- Improves solo session save behavior and completion-note consistency.
- Includes account and visibility settings polish ahead of App Store review.
```

## Submitting to the App Store

The same build uploaded to TestFlight can be submitted to the App Store:

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) -> your app.
2. Confirm the metadata checklist above is fully complete.
3. Select the uploaded TestFlight build under the target version.
4. Click **Add for Review**.
5. Immediately log submission evidence in `ios/QA_CHECKLIST.md`:
   - App Store Connect submission timestamp
   - Version + build number
   - Release owner initials

## App Store review follow-up

Use the operational GitHub issue as the audit log for App Store review status.
For iOS 1.0, that tracker is [issue #103](https://github.com/auerbachb/still-point/issues/103).

Check App Store Connect daily until Apple reaches a final decision or the
submission is intentionally withdrawn. Add at most one dated log entry per day
unless the review status changes that same day.

Daily log template:

```markdown
### YYYY-MM-DD

- **Status:** Waiting for Review | In Review | Rejected | Approved | Ready for Sale | Withdrawn
- **ASC build:** 1.0.0 (4)
- **Submission URL:** https://appstoreconnect.apple.com/apps/.../distribution/reviewsubmissions/details/...
- **Next action:** ...
```

If Apple rejects the submission:

- Paste the reviewer notes verbatim in the dated log entry.
- Link only the engineering issue(s) that will carry implementation work.
- Keep the tracking issue open through fix and resubmit cycles.

If you resubmit:

- Log the new App Store Connect build string, e.g. `1.0.0 (5)`.
- Log the updated submission URL if App Store Connect changes it.
- Include the complete resubmit package:
  - App Review notes describing the account deletion flow from the iOS app.
  - Device screen recording showing sign in, `Settings`, `Delete Account`,
    `Continue`, final `Delete Account`, and return to the signed-out screen.

Close the tracking issue only after Apple approves the app or the submission is
permanently withdrawn. For approval, record the final build, final outcome, and
whether the release shipped, is phased, or is intentionally held.

### App review notes (account deletion)

Include this walkthrough in App Review notes for Guideline 5.1.1(v):

- Sign in with a test account in the iOS app.
- Open `Settings`.
- Tap `Delete Account`.
- In the first prompt, tap `Continue`.
- In the final confirmation alert, tap `Delete Account`.
- Show the app returning to the signed-out/auth screen.

## Troubleshooting

**Build fails with signing error:** verify certificate validity and provisioning profile bundle ID (`com.brettonauerbach.stillpoint`).

**Upload fails with authentication error:** regenerate App Store Connect API key and update GitHub secrets.

**Build number conflict:** `CURRENT_PROJECT_VERSION` must be unique per upload, including re-uploads.

## iOS E2E test policy and runbook

Issue #194 cross-cutting E2E policy applies to iOS and links child issues #191/#192/#193:

- Policy: [`docs/testing/e2e-policy.md`](../docs/testing/e2e-policy.md)
- iOS local runbook: [`ios/E2E_RUNBOOK.md`](./E2E_RUNBOOK.md)
