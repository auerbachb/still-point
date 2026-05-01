import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { closePoolDb, poolDb } from "../../src/db/pool";
import { users } from "../../src/db/schema";
import { MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH, USERNAME_REGEX } from "../../src/lib/username";
import { assertNeonNonProdPostgresUrl } from "../lib/assert-neon-postgres-url";

loadEnvConfig(process.cwd());

function trimEnv(key: string): string {
  return (process.env[key] ?? "").trim();
}

/** Username derived from email hash so it stays unique and within app contract (3–30 chars). */
function deriveUsername(email: string): string {
  const normalized = email.trim().toLowerCase();
  const suffix = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  const candidate = `e2e_${suffix}`;
  if (
    candidate.length < MIN_USERNAME_LENGTH ||
    candidate.length > MAX_USERNAME_LENGTH ||
    !USERNAME_REGEX.test(candidate)
  ) {
    throw new Error("Internal error: derived E2E username does not satisfy app contract.");
  }
  return candidate;
}

export type ProvisionE2EWebUserOptions = {
  email: string;
  password: string;
};

/**
 * Upserts the credentialed E2E web user so its password hash matches CI secrets
 * (survives empty DB, manual wipes, or secret rotation without a manual re-seed).
 */
export async function provisionE2EWebUser(options: ProvisionE2EWebUserOptions): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to provision E2E user with NODE_ENV=production.");
  }

  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl) {
    throw new Error("POSTGRES_URL is required to provision the E2E web user.");
  }

  assertNeonNonProdPostgresUrl(postgresUrl);

  const email = options.email.trim().toLowerCase();
  const password = options.password;
  if (!email || !email.includes("@")) {
    throw new Error("E2E email must be a non-empty address.");
  }
  if (password.length < 8) {
    throw new Error("E2E password must be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const username = deriveUsername(email);

  try {
    // Another account owning this derived username blocks provisioning (rare; hash is unique per email).
    const [nameClash] = await poolDb
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${username.toLowerCase()} and lower(${users.email}) <> ${email}`)
      .limit(1);

    if (nameClash) {
      throw new Error(
        "E2E fixture username collides with another account; remove the conflicting user or change E2E_WEB_EMAIL.",
      );
    }

    // Single atomic upsert on email so parallel Playwright matrix jobs do not race on INSERT.
    await poolDb
      .insert(users)
      .values({
        email,
        username,
        passwordHash,
        currentDay: 1,
        isPublic: false,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          passwordHash,
          username,
          updatedAt: new Date(),
        },
      });
  } finally {
    await closePoolDb();
  }

  console.log("[e2e:setup-web-user] Upserted fixture user (email redacted).");
}

export function readE2EWebCredentials(): { email: string; password: string } | null {
  const webEmail = trimEnv("E2E_WEB_EMAIL");
  const webPassword = trimEnv("E2E_WEB_PASSWORD");
  if (webEmail && webPassword) {
    return { email: webEmail, password: webPassword };
  }

  const testEmail = trimEnv("E2E_TEST_USER_EMAIL");
  const testPassword = trimEnv("E2E_TEST_USER_PASSWORD");
  if (testEmail && testPassword) {
    return { email: testEmail, password: testPassword };
  }

  return null;
}
