import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getCurrentUser = vi.fn();
const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));
const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning }));
const dbInsert = vi.fn(() => ({ values: insertValues }));
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
    insert: dbInsert,
    update: dbUpdate,
  },
}));

vi.mock("@/db/schema", () => ({
  notificationPreferences: {
    userId: "userId",
    pushEnabled: "pushEnabled",
    timezone: "timezone",
    reminderTime: "reminderTime",
    frequency: "frequency",
    quietHoursStart: "quietHoursStart",
    quietHoursEnd: "quietHoursEnd",
    dailyReminderEnabled: "dailyReminderEnabled",
    missADayEnabled: "missADayEnabled",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}));

describe("/api/notifications/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ userId: "user-1", email: "a@b.com" });
  });

  test("GET returns defaults when no row exists", async () => {
    selectLimit.mockResolvedValueOnce([]);
    insertReturning.mockResolvedValueOnce([
      {
        userId: "user-1",
        pushEnabled: false,
        timezone: "UTC",
        reminderTime: "09:00",
        frequency: "daily",
        quietHoursStart: null,
        quietHoursEnd: null,
        dailyReminderEnabled: true,
        missADayEnabled: true,
      },
    ]);

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences.missADayEnabled).toBe(true);
    expect(dbInsert).toHaveBeenCalled();
  });

  test("PATCH validates reminder time", async () => {
    const { PATCH } = await import("./route");
    const request = { json: async () => ({ reminderTime: "25:99" }) } as NextRequest;
    const response = await PATCH(request);
    expect(response.status).toBe(400);
  });
});
