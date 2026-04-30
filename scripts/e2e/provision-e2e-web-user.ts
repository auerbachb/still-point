import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import { poolDb } from "../../src/db/pool";
import { users } from "../../src/db/schema";

loadEnvConfig(process.cwd());

/** Rejects non-Neon or malformed URLs (same guard as `scripts/seed.ts`). */
function assertNeonNonProdPostgresUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("POSTGRES_URL is not a valid URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("POSTGRES_URL must use postgres:// or postgresql://.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(".neon.tech") && host !== "neon.tech") {
    throw new Error(
      "Refusing to provision E2E user: POSTGRES_URL hostname must be a Neon host (*.neon.tech).",
    );
  }
}

function deriveUsername(email: string): string {
  const local = (email.split("@")[0] ?? "user").replace(/[^a-z0-9]/gi, "_").replace(/_+/g, "_");
  const base = `e2e_${local}`.toLowerCase();
  return base.slice(0, 50);
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
        updatedAt: new Date(),
      },
    });

  console.log("[e2e:setup-web-user] Upserted fixture user (email redacted).");
}

export function readE2EWebCredentials(): { email: string; password: string } | null {
  const email = (process.env.E2E_WEB_EMAIL ?? process.env.E2E_TEST_USER_EMAIL ?? "").trim();
  const password = process.env.E2E_WEB_PASSWORD ?? process.env.E2E_TEST_USER_PASSWORD ?? "";
  if (!email || !password) {
    return null;
  }
  return { email, password };
}
