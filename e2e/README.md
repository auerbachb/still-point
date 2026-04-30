# Mobile web E2E (Playwright)

Playwright config lives at the repo root (`playwright.config.ts`). Tests are under `e2e/` and use the `mobile-chromium-narrow`, `mobile-chromium-wide`, and `mobile-webkit-iphone` projects by default.

## Local run (mock API)

By default, `e2e/fixtures/auth.fixture.ts` mocks `/api/**` so no database or credentials are required:

```bash
npm ci
npx playwright install --with-deps chromium webkit
npm run test:e2e
```

## Credentialed run against a remote app (CI / preview)

When tests call the real backend (for example after adding real-auth flows), login returns **401** if the fixture user row is missing or if the password hash in the database no longer matches the secret used in CI.

### Fixture user and secrets

Configure these in **GitHub Actions secrets** (and the same values in your non-production database policy):

| Variable | Purpose |
|----------|---------|
| `E2E_WEB_EMAIL` | Fixture account email (stored lowercased by the app). |
| `E2E_WEB_PASSWORD` | Password that must match the hash stored for that email. |
| `POSTGRES_URL` | Neon **non-production** connection string used to upsert the fixture user before tests. |

Optional aliases: `E2E_TEST_USER_EMAIL` / `E2E_TEST_USER_PASSWORD` are read if the `E2E_WEB_*` names are unset.

**Never** commit real values, paste them into issues or PRs, or print them in logs.

### Automatic provisioning (recommended for CI)

The workflow `.github/workflows/e2e-mobile.yml` sets `E2E_WEB_SETUP_USER=true` and runs Playwright `globalSetup`, which upserts the fixture user via `scripts/e2e/provision-e2e-web-user.ts` (same Neon guard as `scripts/seed.ts`: hostname must be `*.neon.tech`). The hash is derived from `E2E_WEB_PASSWORD`, so it stays aligned with GitHub secrets after deploys, manual DB wipes, or password rotation.

Manual one-off (same as CI global setup):

```bash
export SEED_CONFIRM=still-point-nonprod  # not used by setup-web-user; optional context
export POSTGRES_URL="postgresql://..."   # Neon non-prod only
export E2E_WEB_EMAIL="..."               # from secret store
export E2E_WEB_PASSWORD="..."            # from secret store
export E2E_WEB_SETUP_USER=true           # fail if creds/db missing
npm run e2e:setup-web-user
```

Without `E2E_WEB_SETUP_USER=true`, the script skips if creds or `POSTGRES_URL` are missing (safe for local mock runs).

### Re-seed / diagnostics (operators)

**Root-cause triage** (run against the dev/staging DB; replace the email placeholder with the value from `E2E_WEB_EMAIL` **only in your shell**, never in the issue or git):

```bash
psql "$POSTGRES_URL" -c "SELECT email, created_at, updated_at FROM users WHERE email = '<use-secret-from-E2E_WEB_EMAIL>'"
psql "$POSTGRES_URL" -c "SELECT email, created_at FROM users ORDER BY created_at DESC LIMIT 10"
```

Interpretation (see issue #435):

- No row for the fixture + other recent rows exist → likely post-deploy or automated wipe; rely on **automatic provisioning** above or re-run `npm run e2e:setup-web-user`.
- Row exists but login still 401 → password hash mismatch; confirm `E2E_WEB_PASSWORD` matches what was written (re-run provisioning with the current secret).
- Row exists and local login works with the same secrets → inspect CI env wiring (wrong secret name, wrong workflow, or missing `POSTGRES_URL`).

### Policy alignment

Cross-cutting policy: `docs/testing/e2e-policy.md`. Full app seed for demo data remains `SEED_CONFIRM=still-point-nonprod npm run db:seed` (`scripts/seed.ts`); that is separate from the **single-user** E2E fixture upsert described here.
