# iOS E2E runbook

This runbook mirrors the cross-cutting policy in [`docs/testing/e2e-policy.md`](../docs/testing/e2e-policy.md) and adds iOS-specific commands.

## Required environment

Set the following values through CI secrets (or your shell for local dry-runs):

- `E2E_ENV=ci`
- `E2E_BASE_URL=https://preview-deployment.example.com` (must not be production)
- `E2E_TEST_USER_EMAIL=test+<run-id>@stillpoint.local`
- `E2E_TEST_USER_PASSWORD=<ci-secret>`
- `IOS_TEST_SCHEME=StillPoint`
- `IOS_TEST_PLAN=StillPointE2E` (if present)
- `IOS_TEST_DESTINATION=platform=iOS Simulator,name=iPhone 16,OS=latest`

## One-command lanes

```bash
# Smoke lane
npm run e2e:ios:smoke

# Critical lane
npm run e2e:ios:critical
```

Both commands call `scripts/e2e/run-ios-tests.sh`, which fails fast when:

- The target URL/host appears to be production.
- Required test credentials are missing.
- The test email looks like a real/production account.

## Seed/reset guidance

Use a disposable run id and re-seed before lane runs:

```bash
E2E_RUN_ID=pr123 \
SEED_CONFIRM=still-point-nonprod \
npm run db:seed
```

This creates run-scoped users (email + username suffix) so parallel runs do not collide.

## Artifacts on failure

Each lane attempt records:

- `artifacts/e2e/ios/<lane>-attempt-<n>.log`
- `artifacts/e2e/ios/<lane>-attempt-<n>.xcresult`

When available, CI should also upload screenshots captured by XCTest attachments from the `.xcresult` bundle.

## Reproducing CI failures locally

From a failed CI run, copy:

1. Lane name (`smoke` / `critical`).
2. Attempt number and commit SHA.
3. Same env vars used in CI.

Then run:

```bash
E2E_ENV=ci \
E2E_BASE_URL=<same-preview-url> \
E2E_TEST_USER_EMAIL=<same-run-user> \
E2E_TEST_USER_PASSWORD=<same-secret> \
bash scripts/e2e/run-ios-tests.sh <lane> 1
```

If CI produced `*.xcresult`, inspect with:

```bash
xcrun xcresulttool get --path artifacts/e2e/ios/<lane>-attempt-1.xcresult --format json
```
