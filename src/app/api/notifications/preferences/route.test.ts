import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getCurrentUser = vi.fn();
const getOrCreateNotificationPreferences = vi.fn();
const returning = vi.fn();
const updateWhere = vi.fn(() => ({ returning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));
const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning }));
const dbInsert = vi.fn(() => ({ values: insertValues }));

vi.mock("@/db", () => ({
  db: {
    update: dbUpdate,
    insert: dbInsert,
  },
}));

vi.mock("@/db/schema", () => ({
  notificationPreferences: {
    userId: "userId",
    pushEnabled: "pushEnabled",
    dailyReminderEnabled: "dailyReminderEnabled",
    missADayEnabled: "missADayEnabled",
    dailyReminderTime: "dailyReminderTime",
    dailyReminderFrequency: "dailyReminderFrequency",
    quietHoursStart: "quietHoursStart",
    quietHoursEnd: "quietHoursEnd",
    tz: "tz",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/notification-preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notification-preferences")>();
  return {
    ...actual,
    getOrCreateNotificationPreferences,
  };
});

vi.mock("@/lib/readJsonObject", () => ({
  readJsonObject: async (request: Request) => ({ ok: true, body: await request.json() }),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

const samplePrefs = {
  userId: "user-1",
  pushEnabled: true,
  dailyReminderEnabled: true,
  missADayEnabled: false,
  dailyReminderTime: "09:00",
  dailyReminderFrequency: "daily" as const,
  quietHoursStart: null,
  quietHoursEnd: null,
  tz: "America/New_York",
  createdAt: new Date("2026-05-29T12:00:00.000Z"),
  updatedAt: new Date("2026-05-29T12:00:00.000Z"),
};

describe("/api/notifications/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getCurrentUser.mockResolvedValue({ userId: "user-1", email: "test@example.com" });
    getOrCreateNotificationPreferences.mockResolvedValue(samplePrefs);
    returning.mockResolvedValue([samplePrefs]);
  });

  test("GET returns serialized preferences", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences.pushEnabled).toBe(true);
    expect(body.preferences.tz).toBe("America/New_York");
    expect(getOrCreateNotificationPreferences).toHaveBeenCalledWith("user-1");
  });

  test("PATCH updates push and reminder fields", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({
          pushEnabled: true,
          dailyReminderEnabled: true,
          dailyReminderTime: "08:30",
          dailyReminderFrequency: "weekly",
          tz: "UTC",
        }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(dbUpdate).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        pushEnabled: true,
        dailyReminderTime: "08:30",
        dailyReminderFrequency: "weekly",
      }),
    );
  });

  test("PATCH rejects invalid reminder time", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ dailyReminderTime: "25:99" }),
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("PATCH rejects partial quiet hours updates", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ quietHoursStart: "22:00" }),
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("GET returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
