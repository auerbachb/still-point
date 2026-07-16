import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const verifyAppleJwt = vi.fn();

vi.mock("@/lib/apple-auth", () => ({
  verifyAppleJwt,
}));

const { resolveOAuthUserId } = vi.hoisted(() => ({
  resolveOAuthUserId: vi.fn(),
}));

vi.mock("@/lib/oauth-user-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/oauth-user-resolution")>();
  return {
    ...actual,
    resolveOAuthUserId,
  };
});

const dbSelectWhereLimit = vi.fn();
const dbSelectFromWhere = vi.fn(() => ({ limit: dbSelectWhereLimit }));
const dbSelectFrom = vi.fn(() => ({ where: dbSelectFromWhere }));
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({ from: dbSelectFrom })),
  },
}));

vi.mock("@/db/schema", () => ({
  users: { id: "id", email: "email", username: "username", isPublic: "isPublic", currentDay: "currentDay" },
}));

const createToken = vi.fn();
vi.mock("@/lib/auth", () => ({
  createToken,
  SP_TOKEN_COOKIE: "sp_token",
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ a, b })),
}));

describe("POST /api/auth/apple-native", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    verifyAppleJwt.mockResolvedValue({
      sub: "apple-sub-1",
      email: "relay@privaterelay.appleid.com",
      email_verified: true,
    });
    resolveOAuthUserId.mockResolvedValue("user-uuid-1");
    dbSelectWhereLimit.mockResolvedValue([
      {
        id: "user-uuid-1",
        email: "relay@privaterelay.appleid.com",
        username: "alice",
        isPublic: false,
        currentDay: 3,
      },
    ]);
    createToken.mockResolvedValue("jwt-from-createToken");
  });

  test("returns user + token and sets sp_token cookie on valid identity token", async () => {
    const { POST } = await import("./route");
    const req = {
      json: async () => ({
        identityToken: "header.payload.sig",
        authorizationCode: "opaque-code",
        rawNonce: "nonce-abc",
      }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.token).toBe("jwt-from-createToken");
    expect(json.user.id).toBe("user-uuid-1");
    expect(json.user.username).toBe("alice");

    expect(verifyAppleJwt).toHaveBeenCalledWith("header.payload.sig", {
      expectedNonce: "nonce-abc",
    });
    expect(resolveOAuthUserId).toHaveBeenCalledWith({
      provider: "apple",
      providerAccountId: "apple-sub-1",
      email: "relay@privaterelay.appleid.com",
      profile: { name: null },
    });

    const cookie = res.cookies.get("sp_token");
    expect(cookie?.value).toBe("jwt-from-createToken");
  });

  test("accepts token without email when resolveOAuthUserId links by sub", async () => {
    verifyAppleJwt.mockResolvedValue({
      sub: "apple-sub-repeat",
      email_verified: true,
    });
    const { POST } = await import("./route");
    const req = {
      json: async () => ({ identityToken: "tok", rawNonce: "nonce-abc" }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(resolveOAuthUserId).toHaveBeenCalledWith({
      provider: "apple",
      providerAccountId: "apple-sub-repeat",
      email: undefined,
      profile: { name: null },
    });
  });

  test("returns 401 when nonce verification fails", async () => {
    verifyAppleJwt.mockRejectedValue(new Error("nonce mismatch"));
    const { POST } = await import("./route");
    const req = {
      json: async () => ({
        identityToken: "tok",
        rawNonce: "wrong-nonce",
      }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(resolveOAuthUserId).not.toHaveBeenCalled();
    expect(res.cookies.get("sp_token")).toBeUndefined();
  });

  test("returns 400 when OAuthEmailRequiredError is thrown", async () => {
    const { OAuthEmailRequiredError } = await import("@/lib/oauth-user-resolution");
    verifyAppleJwt.mockResolvedValue({
      sub: "apple-new",
      email_verified: true,
    });
    resolveOAuthUserId.mockRejectedValueOnce(new OAuthEmailRequiredError());
    const { POST } = await import("./route");
    const req = {
      json: async () => ({ identityToken: "tok", rawNonce: "nonce-abc" }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("rejects missing identity token", async () => {
    const { POST } = await import("./route");
    const req = { json: async () => ({ rawNonce: "nonce-abc" }) } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("rejects missing rawNonce", async () => {
    const { POST } = await import("./route");
    const req = { json: async () => ({ identityToken: "tok" }) } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(verifyAppleJwt).not.toHaveBeenCalled();
  });
});
