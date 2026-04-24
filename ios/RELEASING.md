# Releasing Still Point for iOS

## Release-readiness artifacts (Issue #210)

Treat these files as required merge artifacts for iOS release candidates:

- `ios/PARITY_CHECKLIST.md` - feature parity status vs web, including deferred gaps with owner/date.
- `ios/QA_CHECKLIST.md` - regression/QA sign-off, release metadata completion, and submission evidence.

## Prerequisites

The following GitHub repository secrets must be configured (Settings -> Secrets and variables -> Actions):

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `BUILD_CERTIFICATE_BASE64` | Base64-encoded `.p12` distribution certificate | Export from Keychain Access, then `base64 -i cert.p12 \| pbcopy` |
| `P12_PASSWORD` | Password used when exporting the `.p12` | The password you set during `.p12` export |
| `BUILD_PROVISION_PROFILE_BASE64` | Base64-encoded `.mobileprovision` file | Download from developer.apple.com, then `base64 -i profile.mobileprovision \| pbcopy` |
| `APPSTORE_API_KEY_ID` | App Store Connect API Key ID | From appstoreconnect.apple.com -> Users and Access -> Integrations |
| `APPSTORE_API_ISSUER_ID` | App Store Connect API Issuer ID | Same page as above |
| `APPSTORE_API_PRIVATE_KEY` | Contents of the `.p8` API key file | Paste the full file contents including BEGIN/END lines |

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
   CURRENT_PROJECT_VERSION: 6
   ```
3. Commit release artifacts + version bump:
   ```bash
   git add ios/project.yml ios/PARITY_CHECKLIST.md ios/QA_CHECKLIST.md ios/RELEASING.md
   git commit -m "Finalize iOS 1.0.3 (build 6) release readiness"
   ```
4. Tag and push:
   ```bash
   git tag ios-v1.0.3
   git push origin ios-v1.0.3
   ```
5. The GitHub Actions workflow builds and uploads to TestFlight automatically.
6. After Apple processes the build (~15 minutes), it appears in the TestFlight app.
7. Record the processed build number and processing timestamp in `ios/QA_CHECKLIST.md`.

## Version numbering

- `MARKETING_VERSION` - user-facing version (e.g., `1.0.0`, `1.0.3`).
- `CURRENT_PROJECT_VERSION` - build number; increment every upload (`1`, `2`, `3`, ...).
- **Git tag** must match `ios-v*` to trigger [`.github/workflows/ios-testflight.yml`](../.github/workflows/ios-testflight.yml).
- Tag value does not have to equal `MARKETING_VERSION`; uploaded app version is controlled by `ios/project.yml`.
- Re-uploads for same marketing version require a new tag and incremented build number, e.g. `ios-v1.0.3-build7`.

## App Store metadata and release notes checklist

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
