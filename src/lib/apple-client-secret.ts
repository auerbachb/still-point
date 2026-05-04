import { SignJWT, importPKCS8 } from "jose";

const APPLE_JWT_AUDIENCE = "https://appleid.apple.com";
/** Apple allows up to 6 months; stay under with ample margin for cache refresh. */
const SECRET_TTL_SECONDS = 130 * 24 * 60 * 60;
/** Refresh before JWT exp — must stay below SECRET_TTL_SECONDS wall time. */
const CACHE_REFRESH_SKEW_MS = 7 * 24 * 60 * 60 * 1000;

let cache: { jwt: string; expiresAt: number } | null = null;

function requireAppleSigningEnv() {
  const teamId = process.env.APPLE_TEAM_ID;
  const clientId = process.env.AUTH_APPLE_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const rawKey = process.env.APPLE_PRIVATE_KEY;
  if (!teamId || !clientId || !keyId || !rawKey) {
    throw new Error(
      "Apple Sign In is not configured (need AUTH_APPLE_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY)",
    );
  }
  return { teamId, clientId, keyId, rawKey };
}

function normalizePem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("\\n")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return trimmed;
}

/** Mint the ES256 client secret JWT Apple expects for the web/Services ID flow. */
export async function mintAppleClientSecret(): Promise<string> {
  const { teamId, clientId, keyId, rawKey } = requireAppleSigningEnv();
  const pem = normalizePem(rawKey);
  const key = await importPKCS8(pem, "ES256");
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setSubject(clientId)
    .setAudience(APPLE_JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SECRET_TTL_SECONDS)
    .sign(key);
}

/** Cached secret for Auth.js Apple provider (avoids re-importing the key every request). */
export async function getAppleClientSecret(): Promise<string> {
  const now = Date.now();
  if (cache && now < cache.expiresAt - CACHE_REFRESH_SKEW_MS) {
    return cache.jwt;
  }
  const jwt = await mintAppleClientSecret();
  cache = { jwt, expiresAt: now + SECRET_TTL_SECONDS * 1000 };
  return jwt;
}
