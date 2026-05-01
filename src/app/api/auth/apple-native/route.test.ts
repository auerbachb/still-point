import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const jwtVerify = vi.fn();
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify,
}));

const resolveOrCreateUserForOAuthLink = vi.fn();
vi.mock("@/lib/oauth-account-resolution", () => ({
  resolveOrCreateUserForOAuthLink,
}));

const dbSelectLimit = vi.fn();
const dbSelectWhere = vi.fn(() => ({ limit: dbSelectLimit }));
const dbSelectFrom = vi.fn(() => ({ where: dbSelectWhere }));
const dbSelect = vi.fn(() => ({ from: dbSelectFrom }));

vi.mock("@/db", () => ({
  db: { select: dbSelect },
}));

vi.mock("@/db/schema", () => ({
  users: { id: "id" },
}));

const createToken = vi.fn();
const setAuthCookie = vi.fn();
vi.mock("@/lib/auth", () => ({
  createToken,
  setAuthCookie,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ a, b })),
}));

describe("POST /api/auth/apple-native", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_APPLE_ID", "com.example.services");
    jwtVerify.mockResolvedValue({
      payload: {
        sub: "apple-sub-1",
        email: "relay@privaterelay.appleid.com",
        email_verified: true,
        aud: "com.brettonauerbach.stillpoint",
      },
    });
    resolveOrCreateUserForOAuthLink.mockResolvedValue("user-uuid-1");
    dbSelectLimit.mockResolvedValue([
      {
        id: "user-uuid-1",
        email: "relay@privaterelay.appleid.com",
        username: "ada",
        isPublic: false,
        currentDay: 1,
      },
    ]);
    createToken.mockResolvedValue("jwt-token");
  });

  test("returns 400 when identityToken missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://test.local/api/auth/apple-native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorizationCode: "code" }),
      }) as NextRequest,
    );
    expect(res.status).toBe(400);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  test("verifies JWT and returns user JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://test.local/api/auth/apple-native", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-still-point-client": "ios",
        },
        body: JSON.stringify({
          identityToken: "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
          authorizationCode: "auth-code",
          fullName: { givenName: "Ada", familyName: "Lovelace" },
        }),
      }) as NextRequest,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({
      id: "user-uuid-1",
      email: "relay@privaterelay.appleid.com",
      username: "ada",
    });
    expect(body.token).toBe("jwt-token");
    expect(resolveOrCreateUserForOAuthLink).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "apple",
        providerAccountId: "apple-sub-1",
        email: "relay@privaterelay.appleid.com",
        profileName: "Ada Lovelace",
      }),
    );
    expect(createToken).toHaveBeenCalled();
    expect(setAuthCookie).toHaveBeenCalledWith("jwt-token");
  });

  test("rejects wrong audience", async () => {
    jwtVerify.mockResolvedValue({
      payload: {
        sub: "sub",
        email: "a@b.com",
        email_verified: true,
        aud: "wrong.bundle",
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://test.local/api/auth/apple-native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityToken: "t", authorizationCode: "c" }),
      }) as NextRequest,
    );
    expect(res.status).toBe(401);
    expect(resolveOrCreateUserForOAuthLink).not.toHaveBeenCalled();
  });
});
