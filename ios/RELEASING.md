# Releasing Still Point for iOS

This is the engineering release manual: tags, build numbers, CI, credentials, and Fastlane.
The App Store Connect side (reviewer notes, submission, rejection handling, approval) is the
delegate's [iOS App Store submission runbook](../docs/operations/ios-app-store-submission.md).

**Contents**

- **Choose a path:** [Release paths](#release-paths) · [Version numbering](#version-numbering) · [Release-readiness artifacts](#release-readiness-artifacts-issue-210)
- **Set up:** [Prerequisites](#prerequisites) · [First-time setup](#first-time-setup)
- **Cut TestFlight:** [Automatic: merge iOS app code (default)](#automatic-merge-ios-app-code-default) · [Manual tag (break-glass)](#manual-tag-break-glass)
- **Release to the App Store:** [App Store preflight (dry run)](#app-store-preflight-dry-run) · [App Store release (tag → Fastlane)](#app-store-release-tag--fastlane) · [Fastlane (local or debugging)](#fastlane-local-or-debugging) · [Screenshots](#regenerate-candidate-app-store-screenshots-issue-325) · [Metadata and release notes](#app-store-metadata-and-release-notes-checklist)
- **Submit and review:** [App Store submission handoff](#app-store-submission-handoff) · [Submitting to the App Store](#submitting-to-the-app-store) · [App Store review follow-up](#app-store-review-follow-up) · [App review notes (account deletion)](#app-review-notes-account-deletion)
- **Troubleshoot:** [Troubleshooting](#troubleshooting) · [iOS E2E test policy and runbook](#ios-e2e-test-policy-and-runbook)

## Release paths

This table is the one place that says when each path applies and which gates it runs.
Still Point has three iOS release paths. Pick by intent:

| Path | Trigger | Workflow | Use when |
|------|---------|----------|----------|
| **Auto TestFlight** (default) | Any merge to `main` that changes iOS app code | [`ios-testflight-auto.yml`](../.github/workflows/ios-testflight-auto.yml) → [`ios-testflight-build.yml`](../.github/workflows/ios-testflight-build.yml) | Always. There is nothing to do: merged iOS app changes reach TestFlight, and the build number moves by itself. |
| **Manual TestFlight tag** (break-glass) | Push an `ios-v<marketing>-build<n>` tag | [`ios-testflight.yml`](../.github/workflows/ios-testflight.yml) → [`ios-testflight-build.yml`](../.github/workflows/ios-testflight-build.yml) | e2e infra is down, or you need a specific commit cut by hand. Skips the e2e gate. |
| **App Store release** | Push a strict semver `ios-vMAJOR.MINOR.PATCH` tag (no `-build`) | [`ios-app-store-release.yml`](../.github/workflows/ios-app-store-release.yml) | You're uploading metadata + binary to App Store Connect for the version in `ios/project.yml`. Submitting for review stays a human step. |

**Gates.** Both TestFlight paths share the reusable build/upload workflow and run only the
**Release-config UI smoke gate**; the auto path also runs the e2e gates first. The
parity/QA-checklist gate and the App Store dry-run gate run only on the App Store release
path. The auto path's path filter keeps web-only, doc-only, and test-only merges from burning
a TestFlight slot.

## Version numbering

This section owns the version and build-number rules; other sections link here.

- **`MARKETING_VERSION`** — the user-facing version (e.g., `1.0.3`), read from `ios/project.yml`.
  Human-bumped only, never by automation: bump it in an ordinary PR when you want a new
  marketing version. The next cut tags against it and continues the same build counter.
- **Build number (`CFBundleVersion`)** — one global counter for all marketing versions, kept in
  the `ios-v<marketing>-build<N>` tags. Every TestFlight cut and every App Store release run
  claims a number by pushing one tag, and the next claim takes the highest `N` + 1. The
  workflows pass `N` to `xcodebuild` / `gym` as `CURRENT_PROJECT_VERSION`, so the app and both
  extensions always match the tag. Nothing is committed back to `main`.
- **Strictly increasing.** The manual path rejects a tag whose marketing version differs from
  `ios/project.yml` at that commit, or whose build number is not above every other
  `ios-v*-build*` tag (under any marketing version). The App Store workflow checks
  tag ↔ `MARKETING_VERSION` before it claims a number.
- **Claimed numbers stay claimed ([#838](https://github.com/auerbachb/still-point/issues/838)).**
  A run that fails after its claim leaves the tag behind, and the next cut takes the number
  after it. **Re-run failed jobs** keeps the claimed number; re-running *all* jobs claims a new
  one and skips the old one, which App Store Connect accepts.
- **One upload per number.** A build number can reach App Store Connect only once. Shipping the
  same commit again is a new cut with a new tag.
- **What the highest tag means.** The highest `ios-v*-build*` tag is the most recently
  *claimed* build number, by any lane (App Store release runs claim tags too). It does not
  prove that the build succeeded or that App Store Connect processed it — check App Store
  Connect, or run the dry run with `--require-live`.
- **`CURRENT_PROJECT_VERSION` in `ios/project.yml`** is only the default for local builds. It
  does not follow the tags, so don't bump it to ship.
- **Uploads outside CI aren't tracked.** A build uploaded some other way (Xcode Organizer, or the
  Fastlane lanes run locally) is not in the tags, so a later cut can collide with it. See
  [Build number conflict](#troubleshooting).

## Release-readiness artifacts (Issue #210)

Treat these files as required merge artifacts for iOS release candidates. They gate the **App Store release** path only (see [Release paths](#release-paths)), because TestFlight is itself the testing surface.

- `ios/PARITY_CHECKLIST.md` - feature parity status vs web, including deferred gaps with owner/date.
- `ios/QA_CHECKLIST.md` - regression/QA sign-off, release metadata completion, and submission evidence.

## Prerequisites

The following GitHub Actions **secrets** are used by the iOS workflows (already configured for this repo; do not rename). TestFlight cuts and App Store releases both need every one of them. Values never appear in logs or git.

| Secret | Used for |
|--------|----------|
| `BUILD_CERTIFICATE_BASE64` | Distribution signing (`xcodebuild` / `gym`) |
| `P12_PASSWORD` | `.p12` import password |
| `BUILD_PROVISION_PROFILE_BASE64` | App Store provisioning profile for the app |
| `BUILD_PROVISION_PROFILE_EXTENSION_BASE64` | App Store provisioning profile for the `StillPointMonitor` extension |
| `BUILD_PROVISION_PROFILE_WIDGET_BASE64` | App Store provisioning profile for the `StillPointWidget` extension |
| `APPSTORE_API_KEY_ID` | App Store Connect API (JWT `kid`) |
| `APPSTORE_API_ISSUER_ID` | App Store Connect API issuer |
| `APPSTORE_API_PRIVATE_KEY` | API private key (full `.p8` contents as a secret; never commit the file) |

The App Store release workflow maps these to Fastlane’s standard `APP_STORE_CONNECT_API_*` environment names at runtime (see `.github/workflows/ios-app-store-release.yml`).

Both lanes also need the native Google Sign-In client IDs, `GID_CLIENT_ID` and `GID_REVERSED_CLIENT_ID`; `GID_SERVER_CLIENT_ID` is optional. They are listed under *CI credential injection* in [`docs/mobile-oauth-integration.md`](../docs/mobile-oauth-integration.md).

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
2. if both pass, claims the next build number `N` by pushing an `ios-v<MARKETING_VERSION>-build<N>` tag on that commit (see [Version numbering](#version-numbering));
3. calls the reusable workflow to build (Release config) with `CURRENT_PROJECT_VERSION=N` and upload to TestFlight.

The build appears in TestFlight ~15–30 min after the run finishes.

**What counts as iOS app code:** everything under `ios/` except files that never reach the
binary. The exceptions are Markdown and `ios/docs/`, `ios/screenshots/`, and `ios/fastlane/`
together with `ios/Gemfile*` and `ios/ExportOptionsFastlane.plist`. The `StillPointAppUITests`
target, `ios/StillPointShared/Tests/`, and the committed `ios/StillPoint.xcodeproj` don't
count either; CI regenerates the Xcode project with XcodeGen. Files under
`ios/StillPointApp/Resources/` always count. The `paths` filter in the workflow is the
authoritative list. A merge that mixes iOS app code with web or doc changes cuts one build.

**Nothing to bump, nothing to label.** The tag carries the build number, so don't hand-bump
`CURRENT_PROJECT_VERSION` or `MARKETING_VERSION` to ship (rules: [Version numbering](#version-numbering)).
The `release:ios` label is retired and has no effect.

**Several iOS merges in a row:** cuts run one at a time. A merge that lands while a cut is
running queues behind it. A newer iOS merge replaces a queued (not yet running) cut, and
the cut that runs builds the newer `main`, which contains the replaced merge. A burst of
merges ships in fewer builds, and no merge is left out of the next one.

**When a cut fails:** a red e2e gate claims no number. For a flaky test, re-run the failed
jobs. If the fix needs a code change, the merge with the fix cuts by itself when it touches
iOS app code; otherwise, run the workflow by hand after it lands. If the build or upload
fails after the tag was pushed, **Re-run failed jobs** rebuilds that same number (see
[Version numbering](#version-numbering) for what a full re-run does).

To cut the current `main` on demand, run the workflow from the Actions tab
(`workflow_dispatch`); it still goes through the e2e gate. Use that, for example, after a
merge whose commit message carried `[skip ci]`. It also covers a merge so large that
GitHub's path filter skipped it, since the filter reads only the first 300 changed files.

### Manual tag (break-glass)

Cut a build by hand, without the e2e gate. Use it when e2e infra itself is down, or to cut
a specific commit. Gates for this path: [Release paths](#release-paths).

1. Find the highest claimed build number; the next cut is that number + 1:
   ```bash
   git fetch --tags
   git tag -l 'ios-v*-build*' | sed 's/.*-build//' | sort -n | tail -1
   ```
   The tags, and the workflow's check, miss builds uploaded outside CI. If App Store Connect →
   **TestFlight** lists a higher build number, start above that one.
2. Tag the commit and push the tag, using the **TestFlight** tag pattern
   (`ios-v{MARKETING_VERSION}-build{number}`). The marketing version must match
   `ios/project.yml` at that commit:
   ```bash
   git tag ios-v1.0.3-build41 <commit>
   git push origin ios-v1.0.3-build41
   ```
   If the push is rejected because the tag already exists, another cut took that number;
   use the next one. The workflow refuses a number that is not strictly above every other
   build tag (see [Version numbering](#version-numbering)).
3. The [Build & Upload to TestFlight](../.github/workflows/ios-testflight.yml) workflow
   (`ios-v*-build*` tags) builds the tagged commit with the tag's build number and uploads it
   to TestFlight. No `project.yml` bump commit is needed. (A tag push runs the workflow as it
   was at the tagged commit, so a commit from before #707 still builds with its own
   `CURRENT_PROJECT_VERSION`.)
4. After Apple processes the build (~15 minutes), it appears in the TestFlight app.
5. Record the processed build number and processing timestamp in `ios/QA_CHECKLIST.md`.

Before App Store submission, run the [App Store preflight (dry run)](#app-store-preflight-dry-run).

## App Store release (tag → Fastlane)

When you are ready to push **metadata + binary** to App Store Connect for the version in `ios/project.yml` (typically after TestFlight validation):

1. Run the [App Store preflight (dry run)](#app-store-preflight-dry-run) against the build you validated.
2. Ensure `MARKETING_VERSION` in `ios/project.yml` matches the storefront version you intend to ship.
3. Use a **strict semver tag** (no `-build` suffix): `ios-vMAJOR.MINOR.PATCH` must equal `MARKETING_VERSION`, e.g. `ios-v1.0.3`.
4. Push the tag:
   ```bash
   git tag ios-v1.0.3
   git push origin ios-v1.0.3
   ```
5. [iOS App Store release (Fastlane)](../.github/workflows/ios-app-store-release.yml) runs, in order:
   - the smoke tests, and alongside them a check that every secret the release needs is set;
   - the tag and checklist gates;
   - a build-number claim, which pushes `ios-v<MARKETING_VERSION>-build<N>` on the tagged commit;
   - `npm run ios:app-store:dry-run -- --intended-tag <that tag>`;
   - `bundle exec fastlane release` (`gym` with `CURRENT_PROJECT_VERSION=N` → `deliver`).

**Build number:** the App Store build claims its own number like any cut (see
[Version numbering](#version-numbering)), even when TestFlight already cut the tagged commit,
so the upload never repeats a TestFlight build. No `ios/project.yml` bump is needed.

**Secrets ([#937](https://github.com/auerbachb/still-point/issues/937)):** before the claim, the
**Check release secrets** job checks every secret in [Prerequisites](#prerequisites) except the
optional `GID_SERVER_CLIENT_ID`. If one is missing or empty, the run fails there with an error that
names it, and no build number is claimed. The check prints names only, never a value. Add the
secret, then **Re-run failed jobs**.

**First run not yet verified ([#927](https://github.com/auerbachb/still-point/issues/927)):**
until a run of this lane reaches `deliver`, treat the lane as unproven. #910 fixed the dry
run's A3 check and the extension signing that stopped it before upload. Check the
[workflow's run history](https://github.com/auerbachb/still-point/actions/workflows/ios-app-store-release.yml)
for a run that completed `deliver`. If a run fails, submit the TestFlight build you validated
instead (see [Submitting to the App Store](#submitting-to-the-app-store)).

**Submit for review:** CI leaves `SUBMIT_FOR_REVIEW` unset, so `deliver` uses `submit_for_review: false` (upload only; harness / #242 default). Issue **#296** can enable programmatic submission by setting `SUBMIT_FOR_REVIEW=1` in the workflow when a release owner approves.

Optional after #296: set `AUTOMATIC_RELEASE=1` together with `SUBMIT_FOR_REVIEW=1` if automatic release after approval is desired.

### App Store preflight (dry run)

Run the automation dry run before App Store submission and save its artifact:

```bash
npm run ios:app-store:dry-run
```

The report in `artifacts/ios-app-store-dry-run/` confirms source-of-truth
docs, release-readiness checklists, workflow secret references, version/build
values, App Store Connect API readiness, human-owned gates, and fallback
paths. For live App Store Connect build/version validation, provide
`APPSTORE_APP_ID` plus the App Store Connect API key environment variables
and rerun with `-- --require-live`.

The dry run checks one **intended build** (#838). By default that's the highest
`ios-v*-build*` tag on origin: the most recently claimed build number, by any lane (see
[Version numbering](#version-numbering)). If you validated a different build, name it with
its tag:

```bash
npm run ios:app-store:dry-run -- --intended-tag ios-v1.0.3-build41 --require-live
```

`--intended-tag` takes only a build tag (`ios-v<marketing>-build<N>`). If no build tag
can be found, the dry run falls back to `CURRENT_PROJECT_VERSION` in `ios/project.yml` and
warns, because that value no longer names a real build. A tag shows that a build number was
claimed, not that App Store Connect processed it, so use `--require-live` before you submit.

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

`build` (and the `beta` and `release` lanes, which call it) passes `IOS_BUILD_NUMBER` to `gym` as
`CURRENT_PROJECT_VERSION`, for example `IOS_BUILD_NUMBER=42 bundle exec fastlane build`. A value
that isn't a positive integer fails the lane. Without it, `gym` uses `project.yml`'s default, a
number TestFlight already used, so App Store Connect rejects an upload from `beta` or `release`
as a repeat. A local upload is not recorded in the tags (see [Version numbering](#version-numbering)),
so pick a number above every tag and above anything App Store Connect lists.

Lanes are defined in [`fastlane/Fastfile`](./fastlane/Fastfile). App identifier and team are in [`fastlane/Appfile`](./fastlane/Appfile). Default `deliver` options are in [`fastlane/Deliverfile`](./fastlane/Deliverfile). **Localized copy** for `en-US` is under [`fastlane/metadata/en-US/`](./fastlane/metadata/en-US/) (canonical for `deliver`).

## App Store submission handoff

After the intended TestFlight build is processed and valid, use the delegate-ready [iOS App Store submission runbook](../docs/operations/ios-app-store-submission.md) to complete App Store Connect setup, reviewer notes, submission, rejection handling, approval, and release tracking. For what is automated vs manual in tooling, see [Automation evidence log](../docs/operations/automation-evidence.md).

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
- [ ] Build selected is the TestFlight build you validated, or the one the App Store release lane uploaded; its build number is the N in its `ios-v<marketing>-build<N>` tag.
- [ ] Description reflects latest shipping behavior.
- [ ] **Privacy Policy URL** is `https://still-point.me/privacy`.
- [ ] Support URL is configured and reachable.
- [ ] Screenshots are current for all required device classes.
- [ ] App Review notes include account deletion walkthrough.

Release notes template (replace `<MARKETING_VERSION>` and the bullets; keep each bullet to one user-visible change):

```text
Still Point <MARKETING_VERSION> improves <area> and <area>.

- <User-visible change, in plain language.>
- <User-visible change, in plain language.>
- <User-visible change, in plain language.>
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
  - App Review notes with the [account deletion walkthrough](#app-review-notes-account-deletion).
  - Device screen recording showing that walkthrough end to end, from sign in to the
    signed-out screen.

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

**Recovery index** — procedures that live in their own sections:

- A cut failed (red e2e gate, or build/upload after the tag): [When a cut fails](#automatic-merge-ios-app-code-default).
- A release secret is missing or empty: **Secrets** under [App Store release (tag → Fastlane)](#app-store-release-tag--fastlane).
- The App Store release lane failed before upload: fall back to [Submitting to the App Store](#submitting-to-the-app-store) with the validated TestFlight build.
- A local upload collided with the build counter: **Build number conflict** below, and [Fastlane (local or debugging)](#fastlane-local-or-debugging).

**Build fails with signing error:** verify certificate validity and provisioning profile bundle ID (`com.brettonauerbach.stillpoint`).

**Upload fails with authentication error:** regenerate App Store Connect API key and update GitHub secrets.

**Build number conflict:** App Store Connect rejects an upload that repeats a build number it already has for that version. A retry after a failed upload keeps its number; shipping a commit again needs a new cut. A build uploaded outside CI isn't in the tags, so a later cut can collide with it (see [Version numbering](#version-numbering)). To move the counter past such a build, cut a [manual tag](#manual-tag-break-glass) above its number.

**A merge didn't cut a build:** check that it changed iOS app code (see [Automatic: merge iOS app code](#automatic-merge-ios-app-code-default)), then look for a red e2e gate in the **Auto TestFlight on merge** runs. A merge that lands while a cut is queued is built by that later cut. To cut `main` now, run the workflow manually from the Actions tab.

## iOS E2E test policy and runbook

Issue #194 cross-cutting E2E policy applies to iOS and links child issues #191/#192/#193:

- Policy: [`docs/testing/e2e-policy.md`](../docs/testing/e2e-policy.md)
- iOS local runbook: [`ios/E2E_RUNBOOK.md`](./E2E_RUNBOOK.md)
