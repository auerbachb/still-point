# Releasing Still Point for iOS

## Prerequisites

The following GitHub repository secrets must be configured (Settings → Secrets and variables → Actions):

| Secret | Description | How to get it |
|--------|-------------|---------------|
| `BUILD_CERTIFICATE_BASE64` | Base64-encoded `.p12` distribution certificate | Export from Keychain Access, then `base64 -i cert.p12 \| pbcopy` |
| `P12_PASSWORD` | Password used when exporting the `.p12` | The password you set during `.p12` export |
| `BUILD_PROVISION_PROFILE_BASE64` | Base64-encoded `.mobileprovision` file | Download from developer.apple.com, then `base64 -i profile.mobileprovision \| pbcopy` |
| `APPSTORE_API_KEY_ID` | App Store Connect API Key ID | From appstoreconnect.apple.com → Users and Access → Integrations |
| `APPSTORE_API_ISSUER_ID` | App Store Connect API Issuer ID | Same page as above |
| `APPSTORE_API_PRIVATE_KEY` | Contents of the `.p8` API key file | Paste the full file contents including BEGIN/END lines |

## First-Time Setup

Before your first TestFlight release, configure a tester group and handle encryption compliance:

1. Open [App Store Connect](https://appstoreconnect.apple.com) and navigate to your app.
2. Go to `TestFlight` → `Internal Testing` and click the `+` button to create a new group (e.g., "Internal Testers").
3. Add testers to the group by clicking `Add Testers` and entering their Apple ID email addresses.
4. Under the group's `Automatic Distribution` setting, enable it so new builds are distributed to the group automatically.
5. On the first build upload, App Store Connect presents an encryption compliance questionnaire. Select **"None of the algorithms mentioned above"** — Still Point only uses standard HTTPS via `URLSession`, which is exempt.

> **Note:** [#58](https://github.com/auerbachb/still-point/issues/58) tracks automating this via `ITSAppUsesNonExemptEncryption` in `Info.plist`. Until that key is merged and present, expect the encryption questionnaire during upload.

## Releasing to TestFlight

1. Update the version in `ios/project.yml`:
   ```yaml
   MARKETING_VERSION: "1.1.0"
   CURRENT_PROJECT_VERSION: 2
   ```

2. Commit the version bump:
   ```bash
   git add ios/project.yml
   git commit -m "Bump iOS version to 1.1.0 (build 2)"
   ```

3. Tag and push:
   ```bash
   git tag ios-v1.1.0
   git push origin ios-v1.1.0
   ```

4. The GitHub Actions workflow builds and uploads to TestFlight automatically.

5. After Apple processes the build (~15 minutes), it appears in the TestFlight app on your device.

## Version numbering

- `MARKETING_VERSION` — the user-facing version (e.g., `1.0.0`, `1.1.0`)
- `CURRENT_PROJECT_VERSION` — the build number, must increment with every upload (e.g., `1`, `2`, `3`)
- Tag format: `ios-v{MARKETING_VERSION}` (e.g., `ios-v1.0.0`)

## Submitting to the App Store

The same build uploaded to TestFlight can be submitted to the App Store:

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → your app
2. Fill in the required metadata (screenshots, description, privacy policy URL)
3. Select the TestFlight build under the version
4. Click "Add for Review"

## Troubleshooting

**Build fails with signing error:** Verify the certificate hasn't expired and the provisioning profile includes the correct bundle ID (`com.brettonauerbach.stillpoint`).

**Upload fails with authentication error:** Regenerate the App Store Connect API key and update the GitHub secrets.

**Build number conflict:** `CURRENT_PROJECT_VERSION` must be unique per upload. Increment it even for re-uploads of the same marketing version.
