import { provisionE2EWebUser, readE2EWebCredentials } from "./provision-e2e-web-user";

function trimEnv(key: string): string {
  return (process.env[key] ?? "").trim();
}

async function main() {
  const force = process.env.E2E_WEB_SETUP_USER === "true";
  const creds = readE2EWebCredentials();
  const postgresUrl = trimEnv("POSTGRES_URL");

  if (!creds || !postgresUrl) {
    if (force) {
      throw new Error(
        "E2E_WEB_SETUP_USER=true requires POSTGRES_URL plus E2E_WEB_EMAIL/E2E_WEB_PASSWORD or E2E_TEST_USER_EMAIL/E2E_TEST_USER_PASSWORD (non-empty after trim).",
      );
    }
    console.log("[e2e:setup-web-user] Skipping: POSTGRES_URL or fixture credentials not set.");
    return;
  }

  await provisionE2EWebUser(creds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
