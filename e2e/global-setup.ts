import type { FullConfig } from "@playwright/test";
import { provisionE2EWebUser, readE2EWebCredentials } from "../scripts/e2e/provision-e2e-web-user";

/**
 * Ensures the credentialed E2E user exists in Neon before tests hit `/api/auth/login`.
 * Aligns DB password hash with `E2E_WEB_PASSWORD` / `E2E_TEST_USER_PASSWORD` from CI.
 */
export default async function globalSetup(_config: FullConfig) {
  if (process.env.E2E_WEB_SETUP_USER !== "true") {
    return;
  }

  const creds = readE2EWebCredentials();
  if (!creds) {
    throw new Error(
      "E2E_WEB_SETUP_USER=true requires E2E_WEB_EMAIL and E2E_WEB_PASSWORD (or E2E_TEST_USER_*).",
    );
  }
  if (!process.env.POSTGRES_URL) {
    throw new Error("E2E_WEB_SETUP_USER=true requires POSTGRES_URL.");
  }

  await provisionE2EWebUser(creds);
}
