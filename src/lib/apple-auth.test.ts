import { afterEach, describe, expect, test } from "vitest";
import { vi } from "vitest";
import { createHash } from "crypto";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from "jose";
import { APPLE_ISSUER, appleAudiences, verifyAppleJwt } from "./apple-auth";

const BUNDLE_ID = "com.brettonauerbach.stillpoint";
const TEST_KID = "test-key-1";

async function makeAppleLikeKeys(): Promise<{
  privateKey: CryptoKey;
  jwks: JWTVerifyGetKey;
}> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = TEST_KID;
  jwk.alg = "ES256";
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function signNotificationJwt(
  privateKey: CryptoKey,
  { issuer = APPLE_ISSUER, audience = BUNDLE_ID }: { issuer?: string; audience?: string } = {},
): Promise<string> {
  return new SignJWT({
    events: JSON.stringify({
      type: "email-disabled",
      sub: "apple-sub-1",
      event_time: 1_718_000_000_000,
    }),
  })
    .setProtectedHeader({ alg: "ES256", kid: TEST_KID })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setJti("jti-abc")
    .sign(privateKey);
}

function signIdentityJwt(
  privateKey: CryptoKey,
  {
    issuer = APPLE_ISSUER,
    audience = BUNDLE_ID,
    rawNonce,
  }: { issuer?: string; audience?: string; rawNonce?: string } = {},
): Promise<string> {
  const builder = new SignJWT({
    ...(rawNonce !== undefined ? { nonce: sha256Hex(rawNonce) } : {}),
  })
    .setProtectedHeader({ alg: "ES256", kid: TEST_KID })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("apple-sub-native")
    .setIssuedAt();
  return builder.sign(privateKey);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyAppleJwt", () => {
  test("accepts a correctly signed JWT with Apple issuer and bundle-id audience", async () => {
    const { privateKey, jwks } = await makeAppleLikeKeys();
    const token = await signNotificationJwt(privateKey);

    const payload = await verifyAppleJwt(token, { jwks });

    expect(payload.iss).toBe(APPLE_ISSUER);
    expect(payload.aud).toBe(BUNDLE_ID);
    expect(payload.jti).toBe("jti-abc");
    expect(typeof payload.events).toBe("string");
  });

  test("rejects a JWT signed by a different key (bad signature)", async () => {
    const { jwks } = await makeAppleLikeKeys();
    const { privateKey: otherPrivateKey } = await makeAppleLikeKeys();
    const token = await signNotificationJwt(otherPrivateKey);

    await expect(verifyAppleJwt(token, { jwks })).rejects.toThrow();
  });

  test("rejects a JWT with the wrong issuer", async () => {
    const { privateKey, jwks } = await makeAppleLikeKeys();
    const token = await signNotificationJwt(privateKey, { issuer: "https://evil.example.com" });

    await expect(verifyAppleJwt(token, { jwks })).rejects.toThrow();
  });

  test("rejects a JWT with the wrong audience", async () => {
    const { privateKey, jwks } = await makeAppleLikeKeys();
    const token = await signNotificationJwt(privateKey, { audience: "com.someone.else" });

    await expect(verifyAppleJwt(token, { jwks })).rejects.toThrow();
  });

  test("rejects a tampered JWT body", async () => {
    const { privateKey, jwks } = await makeAppleLikeKeys();
    const token = await signNotificationJwt(privateKey);
    const [header, payload, signature] = token.split(".");
    const forged = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    forged.events = JSON.stringify({ type: "account-delete", sub: "attacker-sub" });
    const tampered = [
      header,
      Buffer.from(JSON.stringify(forged)).toString("base64url"),
      signature,
    ].join(".");

    await expect(verifyAppleJwt(tampered, { jwks })).rejects.toThrow();
  });

  test("accepts the web Services ID audience when AUTH_APPLE_ID is set", async () => {
    vi.stubEnv("AUTH_APPLE_ID", "me.still-point.web");
    const { privateKey, jwks } = await makeAppleLikeKeys();
    const token = await signNotificationJwt(privateKey, { audience: "me.still-point.web" });

    const payload = await verifyAppleJwt(token, { jwks });
    expect(payload.aud).toBe("me.still-point.web");
  });

  test("accepts a matching hashed nonce when expectedNonce is provided", async () => {
    const { privateKey, jwks } = await makeAppleLikeKeys();
    const rawNonce = "random-nonce-abc";
    const token = await signIdentityJwt(privateKey, { rawNonce });

    const payload = await verifyAppleJwt(token, { jwks, expectedNonce: rawNonce });

    expect(payload.nonce).toBe(sha256Hex(rawNonce));
  });

  test("rejects a mismatched nonce", async () => {
    const { privateKey, jwks } = await makeAppleLikeKeys();
    const token = await signIdentityJwt(privateKey, { rawNonce: "correct-nonce" });

    await expect(
      verifyAppleJwt(token, { jwks, expectedNonce: "wrong-nonce" }),
    ).rejects.toThrow();
  });

  test("rejects when expectedNonce is provided but the token omits nonce", async () => {
    const { privateKey, jwks } = await makeAppleLikeKeys();
    const token = await signIdentityJwt(privateKey);

    await expect(
      verifyAppleJwt(token, { jwks, expectedNonce: "any-nonce" }),
    ).rejects.toThrow();
  });
});

describe("appleAudiences", () => {
  test("defaults to the iOS bundle id", () => {
    vi.stubEnv("AUTH_APPLE_ID", "");
    expect(appleAudiences()).toEqual([BUNDLE_ID]);
  });

  test("includes AUTH_APPLE_ID and honors AUTH_APPLE_IOS_AUDIENCE override", () => {
    vi.stubEnv("AUTH_APPLE_IOS_AUDIENCE", "com.example.alt");
    vi.stubEnv("AUTH_APPLE_ID", "me.still-point.web");
    expect(appleAudiences()).toEqual(["com.example.alt", "me.still-point.web"]);
  });

  test("does not duplicate when both env vars match", () => {
    vi.stubEnv("AUTH_APPLE_IOS_AUDIENCE", "same.id");
    vi.stubEnv("AUTH_APPLE_ID", "same.id");
    expect(appleAudiences()).toEqual(["same.id"]);
  });
});
