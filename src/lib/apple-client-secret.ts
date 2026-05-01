import { SignJWT, importPKCS8 } from "jose";

const CACHE_MS = 130 * 24 * 60 * 60 * 1000; // ~130 days (< 6 months Apple rotation window)

let cachedSecret: { value: string; expiresAt: number } | null = null;

function normalizePem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("\\n")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return trimmed;
}

/** Mint the client_secret JWT Apple requires for the “web” / server OAuth
 *  client (Services ID). Cached so we do not re-sign on every request. */
export async function getAppleClientSecret(): Promise<string> {
  const now = Date.now();
  if (cachedSecret && cachedSecret.expiresAt > now + 60_000) {
    return cachedSecret.value;
  }

  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.AUTH_APPLE_ID;
  const privateKeyRaw = process.env.APPLE_PRIVATE_KEY;

  if (!teamId || !keyId || !clientId || !privateKeyRaw) {
    throw new Error("Apple OAuth env incomplete: need AUTH_APPLE_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY");
  }

  const privateKey = await importPKCS8(normalizePem(privateKeyRaw), "ES256");

  const issuedAt = Math.floor(now / 1000);
  const expiresAtSec = issuedAt + 60 * 60 * 24 * 150; // 150 days; Apple accepts up to 6 months

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setAudience("https://appleid.apple.com")
    .setSubject(clientId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAtSec)
    .sign(privateKey);

  cachedSecret = {
    value: jwt,
    expiresAt: now + CACHE_MS,
  };

  return jwt;
}
