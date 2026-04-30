import { provisionE2EWebUser, readE2EWebCredentials } from "./provision-e2e-web-user";

async function main() {
  const force = process.env.E2E_WEB_SETUP_USER === "true";
  const creds = readE2EWebCredentials();
  if (!creds) {
    if (force) {
      throw new Error(
        "E2E_WEB_SETUP_USER=true requires E2E_WEB_EMAIL and E2E_WEB_PASSWORD (or E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD).",
      );
    }
    console.log("[e2e:setup-web-user] Skipping: no E2E_WEB_* or E2E_TEST_USER_* credentials set.");
    return;
  }

  if (!process.env.POSTGRES_URL) {
    if (force) {
      throw new Error("E2E_WEB_SETUP_USER=true requires POSTGRES_URL.");
    }
    console.log("[e2e:setup-web-user] Skipping: POSTGRES_URL not set.");
    return;
  }

  await provisionE2EWebUser(creds);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
