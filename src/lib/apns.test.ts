import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { connect, importPKCS8, signJwt } = vi.hoisted(() => ({
  connect: vi.fn(),
  importPKCS8: vi.fn(),
  signJwt: vi.fn(),
}));

vi.mock("node:http2", () => ({
  default: { connect, constants: { NGHTTP2_CANCEL: 8 } },
  connect,
  constants: { NGHTTP2_CANCEL: 8 },
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    importPKCS8,
    SignJWT: vi.fn().mockImplementation(function SignJWTMock() {
      return {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setIssuer: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: signJwt,
      };
    }),
  };
});

import {
  getApnsConfigStatus,
  hashDeviceToken,
  isValidDeviceToken,
  resetApnsProviderTokenCacheForTests,
  sendApnsNotification,
} from "./apns";

type MockRequest = EventEmitter & {
  setEncoding: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function makeMockRequest(): MockRequest {
  const request = new EventEmitter() as MockRequest;
  request.setEncoding = vi.fn();
  request.setTimeout = vi.fn();
  request.close = vi.fn();
  request.end = vi.fn();
  return request;
}

function makeMockClient(request: MockRequest, onRequest?: (headers: Record<string, unknown>) => void) {
  const client = new EventEmitter() as EventEmitter & {
    destroy: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
  };
  client.destroy = vi.fn();
  client.request = vi.fn((headers: Record<string, unknown>) => {
    onRequest?.(headers);
    return request;
  });
  return client;
}

function resolveApnsRequest(
  request: MockRequest,
  {
    status,
    apnsId,
    body,
  }: { status: number; apnsId?: string; body?: string },
) {
  queueMicrotask(() => {
    request.emit("response", { ":status": status, "apns-id": apnsId });
    if (body !== undefined) request.emit("data", body);
    request.emit("end");
  });
}

describe("apns helpers (#539)", () => {
  test("hashDeviceToken normalizes and hashes device tokens", () => {
    const token = "A".repeat(64);
    expect(hashDeviceToken(` ${token.toUpperCase()} `)).toBe(
      createHash("sha256").update(token.toLowerCase()).digest("hex"),
    );
  });

  test("isValidDeviceToken accepts hex tokens and rejects invalid input", () => {
    expect(isValidDeviceToken("a".repeat(64))).toBe(true);
    expect(isValidDeviceToken("not-hex")).toBe(false);
    expect(isValidDeviceToken("abc")).toBe(false);
  });

  test("resetApnsProviderTokenCacheForTests clears cached provider JWT", () => {
    expect(() => resetApnsProviderTokenCacheForTests()).not.toThrow();
  });
});

describe("getApnsConfigStatus (#621)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("reports configured when all four APNs vars are present", () => {
    process.env = {
      ...originalEnv,
      APNS_BUNDLE_ID: "com.example.stillpoint",
      APNS_TEAM_ID: "TEAM123456",
      APNS_KEY_ID: "KEY123456",
      APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
    };
    expect(getApnsConfigStatus()).toEqual({ configured: true, missing: [] });
  });

  test("lists every missing var and reports not configured", () => {
    process.env = { ...originalEnv };
    delete process.env.APNS_BUNDLE_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_PRIVATE_KEY;
    expect(getApnsConfigStatus()).toEqual({
      configured: false,
      missing: ["APNS_BUNDLE_ID", "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY"],
    });
  });

  test("treats an empty-string var as missing", () => {
    process.env = {
      ...originalEnv,
      APNS_BUNDLE_ID: "com.example.stillpoint",
      APNS_TEAM_ID: "TEAM123456",
      APNS_KEY_ID: "KEY123456",
      APNS_PRIVATE_KEY: "",
    };
    expect(getApnsConfigStatus()).toEqual({
      configured: false,
      missing: ["APNS_PRIVATE_KEY"],
    });
  });
});

describe("sendApnsNotification (#539)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      APNS_BUNDLE_ID: "com.example.stillpoint",
      APNS_TEAM_ID: "TEAM123456",
      APNS_KEY_ID: "KEY123456",
      APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
    };

    importPKCS8.mockResolvedValue({ type: "mock-es256-key" });
    signJwt.mockResolvedValue("signed-provider-jwt");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("uses the mocked http2 client instead of opening a real connection", async () => {
    connect.mockImplementation(() => {
      throw new Error("connect was called");
    });

    await expect(
      sendApnsNotification("d".repeat(64), "development", {
        aps: { alert: { title: "T", body: "B" } },
      }),
    ).rejects.toThrow("connect was called");
  });

  test("returns structured failure details for non-2xx APNs responses", async () => {
    const request = makeMockRequest();
    connect.mockReturnValueOnce(makeMockClient(request));

    const promise = sendApnsNotification("c".repeat(64), "production", {
      aps: { alert: { title: "Oops", body: "BadDeviceToken" } },
    });

    resolveApnsRequest(request, {
      status: 400,
      apnsId: "apns-bad",
      body: JSON.stringify({ reason: "BadDeviceToken" }),
    });

    await expect(promise).resolves.toEqual({
      ok: false,
      status: 400,
      reason: "BadDeviceToken",
      apnsId: "apns-bad",
    });
    expect(connect).toHaveBeenCalledWith("https://api.push.apple.com");
  });

  test("mints a provider JWT once and reuses it within the 45-minute cache window", async () => {
    const authHeaders: string[] = [];

    const request1 = makeMockRequest();
    connect.mockReturnValueOnce(
      makeMockClient(request1, (headers) => {
        authHeaders.push(String(headers.authorization));
      }),
    );

    const payload = {
      aps: { alert: { title: "Hello", body: "World" } },
    };

    const firstPromise = sendApnsNotification("a".repeat(64), "development", payload);
    resolveApnsRequest(request1, { status: 200, apnsId: "apns-1" });
    await expect(firstPromise).resolves.toEqual({ ok: true, status: 200, apnsId: "apns-1" });

    const request2 = makeMockRequest();
    connect.mockReturnValueOnce(
      makeMockClient(request2, (headers) => {
        authHeaders.push(String(headers.authorization));
      }),
    );

    const secondPromise = sendApnsNotification("b".repeat(64), "development", payload);
    resolveApnsRequest(request2, { status: 200, apnsId: "apns-2" });
    await expect(secondPromise).resolves.toEqual({ ok: true, status: 200, apnsId: "apns-2" });

    expect(authHeaders).toHaveLength(2);
    expect(authHeaders[0]).toMatch(/^bearer /i);
    expect(authHeaders[1]).toBe(authHeaders[0]);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenNthCalledWith(1, "https://api.sandbox.push.apple.com");
  });
});
