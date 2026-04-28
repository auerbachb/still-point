import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getCurrentUser = vi.fn();
const hashDeviceToken = vi.fn((token: string) => `hash:${token}`);
const isValidDeviceToken = vi.fn((token: string) => /^[0-9a-fA-F]{64,400}$/.test(token));
const returning = vi.fn();
const onConflictDoUpdate = vi.fn(() => ({ returning }));
const insertValues = vi.fn(() => ({ onConflictDoUpdate }));
const dbInsert = vi.fn(() => ({ values: insertValues }));
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));

vi.mock("@/db", () => ({
  db: {
    insert: dbInsert,
    update: dbUpdate,
  },
}));

vi.mock("@/db/schema", () => ({
  deviceTokens: {
    id: "id",
    userId: "userId",
    platform: "platform",
    token: "token",
    tokenHash: "tokenHash",
    apnsEnvironment: "apnsEnvironment",
    enabled: "enabled",
    lastRegisteredAt: "lastRegisteredAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/apns", () => ({
  hashDeviceToken,
  isValidDeviceToken,
}));

vi.mock("@/lib/readJsonObject", () => ({
  readJsonObject: async (request: Request) => ({ ok: true, body: await request.json() }),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

const token = "a".repeat(64);

describe("/api/device-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getCurrentUser.mockResolvedValue({ userId: "user-1", email: "test@example.com" });
    returning.mockResolvedValue([{ id: "device-1", platform: "ios", apnsEnvironment: "development" }]);
    updateReturning.mockResolvedValue([{ id: "device-1" }]);
  });

  test("registers an authenticated iOS APNs token", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://test.local/api/device-token", {
        method: "POST",
        body: JSON.stringify({ token, platform: "ios", apnsEnvironment: "development" }),
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toEqual({
      deviceToken: { id: "device-1", platform: "ios", apnsEnvironment: "development" },
    });
    expect(response.status).toBe(201);
    expect(dbInsert).toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      token,
      platform: "ios",
      apnsEnvironment: "development",
      enabled: true,
    }));
    expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      target: ["tokenHash", "apnsEnvironment"],
      set: expect.objectContaining({ userId: "user-1", enabled: true }),
    }));
  });

  test("rejects malformed tokens", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://test.local/api/device-token", {
        method: "POST",
        body: JSON.stringify({ token: "not-hex", apnsEnvironment: "development" }),
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toEqual({ error: "token must be a valid APNs device token" });
    expect(response.status).toBe(400);
    expect(dbInsert).not.toHaveBeenCalled();
  });

  test("disables a registered token for the authenticated user", async () => {
    const { DELETE } = await import("./route");

    const response = await DELETE(
      new Request("http://test.local/api/device-token", {
        method: "DELETE",
        body: JSON.stringify({ token, apnsEnvironment: "production" }),
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toEqual({ ok: true, removed: true });
    expect(response.status).toBe(200);
    expect(dbUpdate).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
