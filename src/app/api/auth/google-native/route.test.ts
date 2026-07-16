import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const jwtVerify = vi.fn();

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify,
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

describe("POST /api/auth/google-native", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_GOOGLE_IOS_CLIENT_ID", "123-ios.apps.googleusercontent.com");
    vi.stubEnv("AUTH_GOOGLE_ID", "456-web.apps.googleusercontent.com");
    jwtVerify.mockResolvedValue({
      payload: {
        sub: "google-sub-1",
        email: "person@gmail.com",
        email_verified: true,
        name: "Pat Doe",
      },
    });
    resolveOAuthUserId.mockResolvedValue("user-uuid-1");
    dbSelectWhereLimit.mockResolvedValue([
      {
        id: "user-uuid-1",
        email: "person@gmail.com",
        username: "pat",
        isPublic: false,
        currentDay: 3,
      },
    ]);
    createToken.mockResolvedValue("jwt-from-createToken");
  });

  test("returns user + token and sets sp_token cookie on valid id token", async () => {
    const { POST } = await import("./route");
    const req = {
      json: async () => ({ idToken: "header.payload.sig", serverAuthCode: "opaque-code" }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.token).toBe("jwt-from-createToken");
    expect(json.user.id).toBe("user-uuid-1");
    expect(json.user.username).toBe("pat");

    expect(resolveOAuthUserId).toHaveBeenCalledWith({
      provider: "google",
      providerAccountId: "google-sub-1",
      email: "person@gmail.com",
      profile: { name: "Pat Doe" },
    });

    const cookie = res.cookies.get("sp_token");
    expect(cookie?.value).toBe("jwt-from-createToken");
  });

  test("resolves a returning web-Google user by sub and reaches their account", async () => {
    // Same Google `sub` issued to the iOS native client; resolution finds the
    // existing (provider='google', provider_account_id=sub) link from the web flow.
    dbSelectWhereLimit.mockResolvedValue([
      {
        id: "web-user-uuid",
        email: "web.person@gmail.com",
        username: "webpat",
        isPublic: true,
        currentDay: 12,
      },
    ]);
    resolveOAuthUserId.mockResolvedValue("web-user-uuid");
    const { POST } = await import("./route");
    const req = {
      json: async () => ({ idToken: "tok" }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.id).toBe("web-user-uuid");
    expect(json.user.username).toBe("webpat");
  });

  test("returns 401 'Invalid identity token' when the token audience does not match", async () => {
    // jose's jwtVerify throws JWTClaimValidationFailed (claim === "aud") when the
    // ID token's `aud` is not one of the configured Google client IDs — the classic
    // native-flow break where the app mints a token for a client the server does not
    // accept. The route's verification catch maps any such failure to a 401.
    const audError = Object.assign(new Error("unexpected \"aud\" claim value"), {
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
      claim: "aud",
      reason: "check_failed",
    });
    jwtVerify.mockRejectedValueOnce(audError);

    const { POST } = await import("./route");
    const req = {
      json: async () => ({ idToken: "header.payload.sig" }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid identity token");
    // A rejected audience must never resolve or link an account.
    expect(resolveOAuthUserId).not.toHaveBeenCalled();
    expect(res.cookies.get("sp_token")).toBeUndefined();
  });

  test("logs an aud-mismatch diagnostic with the configured audience count, never token contents", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const audError = Object.assign(new Error('unexpected "aud" claim value'), {
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
      claim: "aud",
      reason: "check_failed",
      // jose attaches the decoded Claims Set to claim-validation errors; none
      // of it may reach the log.
      payload: {
        aud: "999-rogue.apps.googleusercontent.com",
        email: "person@gmail.com",
        sub: "google-sub-1",
      },
    });
    jwtVerify.mockRejectedValueOnce(audError);

    const { POST } = await import("./route");
    const req = {
      json: async () => ({ idToken: "header.payload.sig" }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid identity token");

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = consoleError.mock.calls[0].map(String).join(" ");
    expect(logged).toContain("claim=aud");
    expect(logged).toContain("configuredAudiences=2");
    expect(logged).not.toContain("999-rogue.apps.googleusercontent.com");
    expect(logged).not.toContain("person@gmail.com");
    expect(logged).not.toContain("google-sub-1");
    expect(logged).not.toContain('unexpected "aud" claim value');
    consoleError.mockRestore();
  });

  test("logs a signature failure distinctly from an aud mismatch", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const sigError = Object.assign(new Error("signature verification failed"), {
      code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
    });
    jwtVerify.mockRejectedValueOnce(sigError);

    const { POST } = await import("./route");
    const req = {
      json: async () => ({ idToken: "header.payload.sig" }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid identity token");

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = consoleError.mock.calls[0].map(String).join(" ");
    expect(logged).toContain("code=ERR_JWS_SIGNATURE_VERIFICATION_FAILED");
    expect(logged).not.toContain("claim=");
    expect(logged).not.toContain("configuredAudiences=");
    consoleError.mockRestore();
  });

  test("returns 401 when email is present but not verified", async () => {
    jwtVerify.mockResolvedValue({
      payload: {
        sub: "google-unverified",
        email: "unverified@gmail.com",
        email_verified: false,
      },
    });
    const { POST } = await import("./route");
    const req = {
      json: async () => ({ idToken: "tok" }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(resolveOAuthUserId).not.toHaveBeenCalled();
  });

  test("returns 400 when OAuthEmailRequiredError is thrown", async () => {
    const { OAuthEmailRequiredError } = await import("@/lib/oauth-user-resolution");
    jwtVerify.mockResolvedValue({
      payload: {
        sub: "google-new",
        email_verified: true,
      },
    });
    resolveOAuthUserId.mockRejectedValueOnce(new OAuthEmailRequiredError());
    const { POST } = await import("./route");
    const req = {
      json: async () => ({ idToken: "tok" }),
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("rejects missing id token", async () => {
    const { POST } = await import("./route");
    const req = { json: async () => ({}) } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 500 when no Google client IDs are configured", async () => {
    vi.stubEnv("AUTH_GOOGLE_IOS_CLIENT_ID", "");
    vi.stubEnv("AUTH_GOOGLE_ID", "");
    const { POST } = await import("./route");
    const req = {
      json: async () => ({ idToken: "tok" }),
    } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(jwtVerify).not.toHaveBeenCalled();
  });
});
