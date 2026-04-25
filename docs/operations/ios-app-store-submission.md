# iOS App Store submission and delegation runbook

Use this runbook after an iOS build has been uploaded to TestFlight and before clicking **Submit for Review** or **Add for Review** in App Store Connect. It turns issue #164 into a delegate-ready checklist with clear owners and evidence to capture.

## Scope and handoff

- **Engineering** owns tags, GitHub Actions, binary correctness, version/build values, and making sure the shipped app matches review notes.
- **Product / App Store** owns screenshots, copy, age rating, review notes, the account-deletion recording, demo credentials, and release timing.
- **Account Holder / Admin** owns Apple Developer and App Store Connect agreements, tax, and banking.

Record submission status, reviewer notes, build strings, and final outcome in ops tracker #103. Use `ios/RELEASING.md` for tag format, build bumps, and CI upload details.

## Phase A - Preconditions before submission

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 1 | [ ] **Apple Developer + App Store Connect:** all **Agreements, Tax, and Banking** are signed with no **Action required** items. | Account Holder / Admin | Screenshot or written confirmation from Apple Developer/App Store Connect. Uploads fail with `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` until this is clean. |
| 2 | [ ] **GitHub Actions:** latest **Build & Upload to TestFlight** workflow for the intended `ios-v*` tag is green. | Engineering | Link the successful run for `.github/workflows/ios-testflight.yml`. |
| 3 | [ ] **TestFlight:** intended build is visible in App Store Connect -> **TestFlight** and is not stuck **Processing** or marked **Invalid**. | Engineering | Capture App Store Connect build status and processing timestamp. |
| 4 | [ ] **Version / build:** `ios/project.yml` `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` match the intended submission, and the build number is strictly greater than any prior upload for this app. | Engineering | Paste version/build values and compare against prior App Store Connect uploads. |

## Phase B - App Store version record

In App Store Connect, open the app and go to **Distribution** / **App Store** for the target version.

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 5 | [ ] **Create or open** the App Store version, for example `1.0.0`. | Product / App Store | Target version exists in App Store Connect. |
| 6 | [ ] **Attach the build:** select the TestFlight build intended for this version. | Product / App Store + Engineering | Build number on the version page matches `CURRENT_PROJECT_VERSION`. |
| 7 | [ ] **Screenshots:** all required iPhone sizes are present, plus iPad sizes if App Store Connect requires them. | Product / App Store | Screenshot slots show complete assets with no required-size warnings. |
| 8 | [ ] **Metadata:** name, subtitle if used, description, keywords, support URL, and marketing URL if any are complete. | Product / App Store | Version page has no missing required metadata fields. |
| 9 | [ ] **Privacy Policy URL:** set to `https://still-point.me/privacy`. | Product / App Store | URL field exactly matches project docs. |
| 10 | [ ] **Age rating** questionnaire is complete. | Product / App Store | Age rating section has no incomplete status. |
| 11 | [ ] **Export compliance** is complete or covered in app metadata as applicable. | Product / App Store + Engineering | Confirm export compliance section is accepted. The app sets `ITSAppUsesNonExemptEncryption` to `false` in `ios/project.yml`. |
| 12 | [ ] **App Review contact** and phone are present if required. | Product / App Store | Review contact section is complete. |

## Phase C - App Review information

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 13 | [ ] **Notes for reviewer:** short and factual, including how to sign in and the exact account deletion path. Mention **Guideline 5.1.1(v)** if responding to that rejection thread. | Product / App Store + Engineering | Use the account deletion path from `ios/RELEASING.md`; verify the binary follows the same path. |
| 14 | [ ] **Attachment:** screen recording from a physical iPhone showing sign-in -> **Settings** -> **Delete account** -> confirm -> signed out. | Product / App Store | Attach the recording to App Review Information and confirm it matches the submitted binary. |
| 15 | [ ] **Demo credentials:** provide private review-field credentials if the app cannot be exercised without an existing account, or document a reliable signup path. | Product / App Store | Private review fields are populated or signup instructions are clear. |

## Phase D - Submit

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 16 | [ ] Version page has the intended build attached and all App Store Connect warnings/blockers resolved. | Product / App Store + Engineering | Re-open the version page immediately before submission and confirm no blockers remain. |
| 17 | [ ] Click **Submit for Review** or **Add for Review**; wording varies for first submit versus update. | Product / App Store | Capture submission timestamp in #103. |
| 18 | [ ] Monitor status until **In Review** then **Approved** or **Rejected**. | Product / App Store | Post daily status in #103 while waiting. |

## Phase E - If rejected

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 19 | [ ] Copy reviewer notes verbatim into #103 and link engineering issues per finding; keep implementation discussion out of #103. | Product / App Store | #103 contains exact reviewer language and links to follow-up issues. |
| 20 | [ ] Fix code/config, bump iOS build, and push a new `ios-v*` tag or re-run CI per `ios/RELEASING.md`. | Engineering | New build number is strictly incremented and TestFlight upload is green. |
| 21 | [ ] Attach the new build, update review notes and recording if the reviewed flow changed, then resubmit. | Product / App Store + Engineering | Version page references the replacement build and updated review materials. |

## Phase F - If approved

| # | Check | Owner | Evidence / action |
|---|-------|-------|-------------------|
| 22 | [ ] Choose release strategy: manual release, automatic release, or phased rollout. | Product / App Store | Strategy is selected in App Store Connect. |
| 23 | [ ] Add final #103 log entry with date, version + build, and outcome: shipped, held, or phased. | Product / App Store | #103 has final release outcome. |
| 24 | [ ] Close #103 when submission tracking is complete per its definition of done. | Product / App Store | #103 is closed only after the submission lifecycle is complete. |

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

## Related links

- Ops / submission log: #103
- Submit / archive checklist (historical): #37
- CI workflow: `.github/workflows/ios-testflight.yml`
- Release / tag / build docs: `ios/RELEASING.md`
- App Store Connect example submission URL: <https://appstoreconnect.apple.com/apps/6761392660/distribution/reviewsubmissions/details/bf5f6c23-dffa-4942-aac1-2afd22ffa8f9>
