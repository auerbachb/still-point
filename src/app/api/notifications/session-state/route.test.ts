import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getCurrentUser = vi.fn();
const getOrCreateNotificationPreferences = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));

vi.mock("@/db", () => ({
  db: { update: dbUpdate },
}));

vi.mock("@/db/schema", () => ({
  notificationPreferences: {
    userId: "userId",
    suppressDuringSession: "suppressDuringSession",
    sessionActiveUntil: "sessionActiveUntil",
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/notification-preferences", () => ({
  getOrCreateNotificationPreferences,
}));

vi.mock("@/lib/readJsonObject", () => ({
  readJsonObject: async (request: Request) => ({ ok: true, body: await request.json() }),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

function post(body: unknown): NextRequest {
  return new Request("http://test.local/api/notifications/session-state", {
    method: "POST",
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("/api/notifications/session-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getCurrentUser.mockResolvedValue({ userId: "user-1", email: "test@example.com" });
    getOrCreateNotificationPreferences.mockResolvedValue({
      userId: "user-1",
      suppressDuringSession: true,
      sessionActiveUntil: null,
    });
  });

  test("stores a TTL-bounded window when a sit starts", async () => {
    const { POST } = await import("./route");
    const { SESSION_ACTIVE_TTL_MS } = await import("@/lib/notifications/session-active");

    const before = Date.now();
    const response = await POST(post({ active: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    const until = new Date(body.sessionActiveUntil).getTime();
    expect(until).toBeGreaterThanOrEqual(before + SESSION_ACTIVE_TTL_MS);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ sessionActiveUntil: expect.any(Date) }),
    );
  });

  test("does not bump updatedAt on a heartbeat", async () => {
    const { POST } = await import("./route");

    await POST(post({ active: true }));

    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(expect.not.objectContaining({ updatedAt: expect.anything() }));
  });

  test("clears the window when the sit ends", async () => {
    getOrCreateNotificationPreferences.mockResolvedValue({
      userId: "user-1",
      suppressDuringSession: true,
      sessionActiveUntil: new Date("2026-06-01T12:02:00.000Z"),
    });
    const { POST } = await import("./route");

    const response = await POST(post({ active: false }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionActiveUntil).toBeNull();
    expect(updateSet).toHaveBeenCalledWith({ sessionActiveUntil: null });
  });

  test("does not track users who opted out of silencing", async () => {
    getOrCreateNotificationPreferences.mockResolvedValue({
      userId: "user-1",
      suppressDuringSession: false,
      sessionActiveUntil: null,
    });
    const { POST } = await import("./route");

    const response = await POST(post({ active: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionActiveUntil).toBeNull();
    expect(body.suppressDuringSession).toBe(false);
    // Nothing to write: the row is already clear.
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("skips the write when clearing an already-clear row", async () => {
    const { POST } = await import("./route");

    await POST(post({ active: false }));

    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("rejects a non-boolean active flag", async () => {
    const { POST } = await import("./route");

    const response = await POST(post({ active: "yes" }));

    expect(response.status).toBe(400);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("requires authentication", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { POST } = await import("./route");

    const response = await POST(post({ active: true }));

    expect(response.status).toBe(401);
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});
