import type { FullConfig } from "@playwright/test";
import { provisionE2EWebUser, readE2EWebCredentials } from "../scripts/e2e/provision-e2e-web-user";

function trimEnv(key: string): string {
  return (process.env[key] ?? "").trim();
}

/**
 * Ensures the credentialed E2E user exists in Neon before tests hit `/api/auth/login`.
 * Aligns DB password hash with `E2E_WEB_PASSWORD` / `E2E_TEST_USER_PASSWORD` from CI.
 *
 * When `E2E_WEB_SETUP_USER=true` but secrets are not configured (empty in GitHub Actions),
 * skips so default mock-based mobile E2E keeps passing until operators add secrets.
 */
export default async function globalSetup(_config: FullConfig) {
  if (process.env.E2E_WEB_SETUP_USER !== "true") {
    return;
  }

  const postgresUrl = trimEnv("POSTGRES_URL");
  const creds = readE2EWebCredentials();

  if (!postgresUrl || !creds) {
    console.warn(
      "[e2e:global-setup] E2E_WEB_SETUP_USER=true but POSTGRES_URL or fixture credentials are missing — skipping DB provisioning (mock API tests will still run).",
    );
    return;
  }

  await provisionE2EWebUser(creds);
}
