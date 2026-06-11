import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { verifyAppleJwt, handleAppleNotificationEvent, logAppleNotification } = vi.hoisted(() => ({
  verifyAppleJwt: vi.fn(),
  handleAppleNotificationEvent: vi.fn(),
  logAppleNotification: vi.fn(),
}));

vi.mock("@/lib/apple-auth", () => ({
  verifyAppleJwt,
}));

vi.mock("@/lib/apple-notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/apple-notifications")>();
  return {
    ...actual,
    handleAppleNotificationEvent,
    logAppleNotification,
  };
});

function requestWithBody(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const VALID_CLAIMS = {
  iss: "https://appleid.apple.com",
  aud: "com.brettonauerbach.stillpoint",
  jti: "jti-abc",
  events: JSON.stringify({
    type: "account-delete",
    sub: "apple-sub-1",
    event_time: 1_718_000_000_000,
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  verifyAppleJwt.mockResolvedValue(VALID_CLAIMS);
  handleAppleNotificationEvent.mockResolvedValue({
    actionTaken: "account_deleted",
    userId: "user-uuid-1",
  });
  logAppleNotification.mockResolvedValue(undefined);
});

describe("POST /api/auth/apple/notifications", () => {
  test("processes a verified notification and writes the audit log", async () => {
    const { POST } = await import("./route");

    const res = await POST(requestWithBody({ payload: "header.payload.sig" }));

    expect(res.status).toBe(200);
    expect(verifyAppleJwt).toHaveBeenCalledWith("header.payload.sig");
    expect(handleAppleNotificationEvent).toHaveBeenCalledWith({
      type: "account-delete",
      sub: "apple-sub-1",
      event_time: 1_718_000_000_000,
    });
    expect(logAppleNotification).toHaveBeenCalledWith({
      eventType: "account-delete",
      subject: "apple-sub-1",
      eventTime: 1_718_000_000_000,
      jti: "jti-abc",
      userId: "user-uuid-1",
      actionTaken: "account_deleted",
    });
  });

  test("returns 400 on unparseable JSON body", async () => {
    const { POST } = await import("./route");
    const req = {
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(verifyAppleJwt).not.toHaveBeenCalled();
  });

  test("returns 400 when payload is missing or not a string", async () => {
    const { POST } = await import("./route");

    expect((await POST(requestWithBody({}))).status).toBe(400);
    expect((await POST(requestWithBody({ payload: 42 }))).status).toBe(400);
    expect(verifyAppleJwt).not.toHaveBeenCalled();
  });

  test("returns 401 when JWT verification fails and never touches handlers", async () => {
    verifyAppleJwt.mockRejectedValue(new Error("signature verification failed"));
    const { POST } = await import("./route");

    const res = await POST(requestWithBody({ payload: "forged.jwt.token" }));

    expect(res.status).toBe(401);
    expect(handleAppleNotificationEvent).not.toHaveBeenCalled();
    expect(logAppleNotification).not.toHaveBeenCalled();
  });

  test("returns 400 when the events claim is malformed", async () => {
    verifyAppleJwt.mockResolvedValue({ ...VALID_CLAIMS, events: "{{not-json" });
    const { POST } = await import("./route");

    const res = await POST(requestWithBody({ payload: "tok" }));

    expect(res.status).toBe(400);
    expect(handleAppleNotificationEvent).not.toHaveBeenCalled();
  });

  test("returns 500 when handling fails so Apple retries", async () => {
    handleAppleNotificationEvent.mockRejectedValue(new Error("db down"));
    const { POST } = await import("./route");

    const res = await POST(requestWithBody({ payload: "tok" }));

    expect(res.status).toBe(500);
    expect(logAppleNotification).not.toHaveBeenCalled();
  });

  test("duplicate deliveries still return 200 and are audited", async () => {
    handleAppleNotificationEvent.mockResolvedValue({
      actionTaken: "noop_user_not_found",
      userId: null,
    });
    const { POST } = await import("./route");

    const res = await POST(requestWithBody({ payload: "tok" }));

    expect(res.status).toBe(200);
    expect(logAppleNotification).toHaveBeenCalledWith(
      expect.objectContaining({ actionTaken: "noop_user_not_found", userId: null }),
    );
  });
});
