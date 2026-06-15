import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/** Issuer for every Sign in with Apple JWT (identity tokens and server-to-server notifications). */
export const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = `${APPLE_ISSUER}/auth/keys`;

let remoteJwks: JWTVerifyGetKey | null = null;

/** Shared remote JWKS — jose caches the key set and refetches on rotation. */
function getAppleJwks(): JWTVerifyGetKey {
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  }
  return remoteJwks;
}

/** Client IDs Apple may use as `aud` for this app: the iOS App ID bundle identifier
 *  (server-to-server notifications are configured on the App ID) plus the web
 *  Services ID (`AUTH_APPLE_ID`) when configured. */
export function appleAudiences(): string[] {
  // Blank env values count as unset — `AUTH_APPLE_IOS_AUDIENCE=` in an env file
  // must not make "" the only accepted audience and reject every notification.
  const iosAudience = process.env.AUTH_APPLE_IOS_AUDIENCE?.trim();
  const audiences = [iosAudience || "com.brettonauerbach.stillpoint"];
  const servicesId = process.env.AUTH_APPLE_ID?.trim();
  if (servicesId && !audiences.includes(servicesId)) {
    audiences.push(servicesId);
  }
  return audiences;
}

export type VerifyAppleJwtOptions = {
  /** Override the accepted audiences (defaults to `appleAudiences()`). */
  audience?: string | string[];
  /** Test seam: local key set instead of Apple's remote JWKS. */
  jwks?: JWTVerifyGetKey;
};

/** Verify an Apple-signed JWT — signature against Apple's JWKS, issuer, audience —
 *  and return its payload. Throws on any verification failure. */
export async function verifyAppleJwt(
  token: string,
  options: VerifyAppleJwtOptions = {},
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, options.jwks ?? getAppleJwks(), {
    issuer: APPLE_ISSUER,
    audience: options.audience ?? appleAudiences(),
  });
  return payload;
}
