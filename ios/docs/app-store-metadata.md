# App Store Connect — canonical marketing copy

This file documents **positioning and parity** for App Store Connect. The **machine-deliverable** strings (name, subtitle, description, keywords, release notes, URLs, review notes) live under [`../fastlane/metadata/`](../fastlane/metadata/) as `deliver` locale files (`en-US` is canonical). Reconcile App Store Connect with those files when preparing a submission. If the live storefront differs, update ASC or the `fastlane/metadata` files (and this doc if narrative context changes) and note the change in release notes or the PR that touched copy.

## Manual fix (issue #195)

The App Store **subtitle** must spell **meditate** correctly (not `medite`). In App Store Connect, open **Still Point Timer** → **App Information** / the target **version** → check **Subtitle**, **Description**, **Keywords**, and **What’s New** for the same typo.

## App identity

| Field | Canonical value |
|--------|------------------|
| **Name** | Still Point |
| **Subtitle** | `Meditate one minute at a time` (30 characters max in App Store Connect; spell **meditate**, never `medite`.) |
| **Privacy Policy URL** | `https://still-point.me/privacy` |

If marketing chooses a different approved subtitle, replace the **Subtitle** cell here and in App Store Connect so the repo remains the single source of truth.

## Promotional / description alignment (web parity)

These strings already ship on the marketing site and are safe references for **Description** or **Promotional Text** in App Store Connect:

**Short positioning (site meta description)** — from `src/app/layout.tsx`:

> Build steadier focus with a guided one-minute meditation practice designed for real, distractible days.

**Expanded one-liner (landing)** — from `src/app/page.tsx`:

> Still Point is a meditation timer for people struggling to get started and stay consistent: it begins at one minute, adds ten seconds per day, and shows time as boxes that fill up as you go to make sitting still easier.

## iOS parity strings (in-app, not ASC-only)

- Screen Time usage purpose (`ios/StillPointApp/Info.plist`): explains blocking selected apps until the user completes a **meditation** session.
- Buddy feature surface copy uses **Meditate with a friend** (`HomeView`, `BuddySessionHubView`).

## Release notes

Use the template in [`ios/RELEASING.md`](../RELEASING.md) (section *App Store metadata and release notes checklist*) for version-specific “What’s New” text; keep spelling consistent with this doc.

## Related runbooks

- [`ios/RELEASING.md`](../RELEASING.md) — tags, TestFlight, submission checklist.
- [`docs/operations/ios-app-store-submission.md`](../../docs/operations/ios-app-store-submission.md) — delegate submission runbook.
