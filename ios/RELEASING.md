# Releasing Still Point for iOS

## Release-readiness artifacts (Issue #210)

Treat these files as required merge artifacts for iOS release candidates. They gate the **App Store release** path (`ios-app-store-release.yml`); the TestFlight paths below do **not** enforce them, because TestFlight is itself the testing surface.

- `ios/PARITY_CHECKLIST.md` - feature parity status vs web, including deferred gaps with owner/date.
- `ios/QA_CHECKLIST.md` - regression/QA sign-off, release metadata completion, and submission evidence.

## Release paths

Still Point has three iOS release paths. Pick by intent:

| Path | Trigger | Workflow | Use when |
|------|---------|----------|----------|
| **Auto TestFlight** (default) | Any merge to `main` that changes iOS app code | [`ios-testflight-auto.yml`](../.github/workflows/ios-testflight-auto.yml) → [`ios-testflight-build.yml`](../.github/workflows/ios-testflight-build.yml) | Always. There is nothing to do: merged iOS app changes reach TestFlight, and the build number moves by itself. |
| **Manual TestFlight tag** (break-glass) | Push an `ios-v<marketing>-build<n>` tag | [`ios-testflight.yml`](../.github/workflows/ios-testflight.yml) → [`ios-testflight-build.yml`](../.github/workflows/ios-testflight-build.yml) | e2e infra is down, or you need a specific commit cut by hand. Skips the e2e gate. |
| **App Store release** | Push a strict semver `ios-vMAJOR.MINOR.PATCH` tag (no `-build`) | [`ios-app-store-release.yml`](../.github/workflows/ios-app-store-release.yml) | You're shipping metadata + binary to the App Store for the version in `ios/project.yml`. |

Both TestFlight paths share the reusable build/upload workflow and run only the
**Release-config UI smoke gate**; the parity/QA-checklist and App Store dry-run gates
are reserved for the App Store release path. The auto path's path filter keeps
web-only, doc-only, and test-only merges from burning a TestFlight slot.

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

### Automatic: merge iOS app code (default)

Merging to `main` is the whole procedure (#707). When a merge changes iOS app code,
[`ios-testflight-auto.yml`](../.github/workflows/ios-testflight-auto.yml):

1. runs the mobile-web (`e2e-mobile.yml`) and native iOS (`e2e-ios.yml`) e2e gates on the merge commit;
2. if both pass, claims the next build number `N` (1 + the highest `ios-v*-build*` tag) by pushing an `ios-v<MARKETING_VERSION>-build<N>` tag on that commit;
3. calls the reusable workflow to build (Release config) with `CURRENT_PROJECT_VERSION=N` and upload to TestFlight.

The build appears in TestFlight ~15–30 min after the run finishes.

**What counts as iOS app code:** everything under `ios/` except files that never reach the
binary. The exceptions are Markdown and `ios/docs/`, `ios/screenshots/`, and `ios/fastlane/`
together with `ios/Gemfile*` and `ios/ExportOptionsFastlane.plist`. The `StillPointAppUITests`
target, `ios/StillPointShared/Tests/`, and the committed `ios/StillPoint.xcodeproj` don't
count either; CI regenerates the Xcode project with XcodeGen. Files under
`ios/StillPointApp/Resources/` always count. The `paths` filter in the workflow is the
authoritative list. A merge that mixes iOS app code with web or doc changes cuts one build.

**Nothing to bump, nothing to label.** Don't hand-bump `CURRENT_PROJECT_VERSION` to ship.
The tag carries the build number, and nothing is committed back to `main`. The
`release:ios` label is retired and has no effect. `MARKETING_VERSION` is **never**
auto-bumped — that's a human decision. Bump it in `ios/project.yml` in an ordinary PR when
you want a new marketing version; the next cut tags against it and continues the same build
counter.

**Several iOS merges in a row:** cuts run one at a time. A merge that lands while a cut is
running queues behind it. A newer iOS merge replaces a queued (not yet running) cut, and
the cut that runs builds the newer `main`, which contains the replaced merge. A burst of
merges ships in fewer builds, and no merge is left out of the next one.

**When a cut fails:** a red e2e gate claims no number. For a flaky test, re-run the failed
jobs. If the fix needs a code change, the merge with the fix cuts by itself when it touches
iOS app code; otherwise, run the workflow by hand after it lands. If the build or upload
fails after the tag was pushed, **Re-run failed jobs** rebuilds that same number. Re-running
*all* jobs claims a new number and skips the old one, which App Store Connect accepts.

To cut the current `main` on demand, run the workflow from the Actions tab
(`workflow_dispatch`); it still goes through the e2e gate. Use that, for example, after a
merge whose commit message carried `[skip ci]`. It also covers a merge so large that
GitHub's path filter skipped it, since the filter reads only the first 300 changed files.

### Manual tag (break-glass)

Cut a build by hand, without the e2e gate. Use it when e2e infra itself is down, or to cut
a specific commit. TestFlight does not require the parity/QA checklists — those gate the
App Store release path.

1. Find the highest build number in use; the next cut is that number + 1:
   ```bash
   git fetch --tags
   git tag -l 'ios-v*-build*' | sed 's/.*-build//' | sort -n | tail -1
   ```
2. Tag the commit and push the tag, using the **TestFlight** tag pattern
   (`ios-v{MARKETING_VERSION}-build{number}`). The marketing version must match
   `ios/project.yml` at that commit:
   ```bash
   git tag ios-v1.0.3-build41 <commit>
   git push origin ios-v1.0.3-build41
   ```
   If the push is rejected because the tag already exists, another cut took that number;
   use the next one. The workflow also refuses a number that a tag for another marketing
   version already holds.
3. The [Build & Upload to TestFlight](../.github/workflows/ios-testflight.yml) workflow
   (`ios-v*-build*` tags) builds the tagged commit with the tag's build number and uploads it
   to TestFlight. No `project.yml` bump commit is needed. (A tag push runs the workflow as it
   was at the tagged commit, so a commit from before #707 still builds with its own
   `CURRENT_PROJECT_VERSION`.)
4. After Apple processes the build (~15 minutes), it appears in the TestFlight app.
5. Record the processed build number and processing timestamp in `ios/QA_CHECKLIST.md`.
6. Before App Store submission, run the automation dry run and save its artifact:
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

**Build number caveat ([#838](https://github.com/auerbachb/still-point/issues/838)):** `gym`
builds with `CURRENT_PROJECT_VERSION` from `ios/project.yml`. TestFlight cuts no longer advance
that value; their numbers live in the `ios-v*-build*` tags. A PR that bumps it is itself an
iOS change, so it cuts a TestFlight build with the next number. Until #838 gives this lane its
own number, submit the TestFlight build you validated instead (see
[Submitting to the App Store](#submitting-to-the-app-store)).

**Submit for review:** CI leaves `SUBMIT_FOR_REVIEW` unset, so `deliver` uses `submit_for_review: false` (upload only; harness / #242 default). Issue **#296** can enable programmatic submission by setting `SUBMIT_FOR_REVIEW=1` in the workflow when a release owner approves.

Optional after #296: set `AUTOMATIC_RELEASE=1` together with `SUBMIT_FOR_REVIEW=1` if automatic release after approval is desired.

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

- `MARKETING_VERSION` - user-facing version (e.g., `1.0.0`, `1.0.3`). Human-bumped only.
- Build number (`CFBundleVersion`) - one counter for all marketing versions, kept in the `ios-v<marketing>-build<N>` tags. Every TestFlight cut pushes one tag, and the next cut takes the highest `N` + 1. Both TestFlight paths pass `N` to `xcodebuild` as `CURRENT_PROJECT_VERSION`, so the app and both extensions always match the tag.
- `CURRENT_PROJECT_VERSION` in `ios/project.yml` is only the default for local builds (and for the App Store lane until [#838](https://github.com/auerbachb/still-point/issues/838)). It does not follow TestFlight builds, so don't bump it to ship one.
- **Auto TestFlight:** a merge to `main` that changes iOS app code triggers [`.github/workflows/ios-testflight-auto.yml`](../.github/workflows/ios-testflight-auto.yml). The workflow claims the next `ios-v<marketing>-build<n>` tag and calls [`.github/workflows/ios-testflight-build.yml`](../.github/workflows/ios-testflight-build.yml).
- **Manual TestFlight:** push a tag matching `ios-v*-build*` (e.g. `ios-v1.0.3-build41`) to trigger [`.github/workflows/ios-testflight.yml`](../.github/workflows/ios-testflight.yml).
- **App Store automation:** push a strict semver tag `ios-vMAJOR.MINOR.PATCH` that **equals** `MARKETING_VERSION` to trigger [`.github/workflows/ios-app-store-release.yml`](../.github/workflows/ios-app-store-release.yml).
- The uploaded marketing version comes from `ios/project.yml`; the TestFlight build number comes from the tag. The manual path rejects a tag whose marketing version differs from `ios/project.yml` or whose build number another `ios-v*-build*` tag already holds, and the App Store workflow enforces tag ↔ `MARKETING_VERSION`.
- Every upload needs a new build number. A re-upload of the same commit is a new cut with a new tag.

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

   Use `bundle exec fastlane upload_app_store_screenshots` for screenshot-only uploads. Note: `bundle exec fastlane release` now runs preflight → gym → deliver (builds and uploads the IPA) — do not use it for screenshots only.

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

**Build number conflict:** every upload needs an unused build number, including re-uploads. TestFlight cuts take theirs from the `ios-v*-build*` tags, so a build uploaded some other way (Xcode Organizer, the Fastlane lanes) can collide with a later cut.

**A merge didn't cut a build:** check that it changed iOS app code (see [Automatic: merge iOS app code](#automatic-merge-ios-app-code-default)), then look for a red e2e gate in the **Auto TestFlight on merge** runs. A merge that lands while a cut is queued is built by that later cut. To cut `main` now, run the workflow manually from the Actions tab.

## iOS E2E test policy and runbook

Issue #194 cross-cutting E2E policy applies to iOS and links child issues #191/#192/#193:

- Policy: [`docs/testing/e2e-policy.md`](../docs/testing/e2e-policy.md)
- iOS local runbook: [`ios/E2E_RUNBOOK.md`](./E2E_RUNBOOK.md)
