import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getCurrentUser = vi.fn();
const getOrCreateNotificationPreferences = vi.fn();
const returning = vi.fn();
const updateWhere = vi.fn(() => ({ returning }));
const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));
const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning }));
const dbInsert = vi.fn(() => ({ values: insertValues }));
const dbExecute = vi.fn((_query: { values?: unknown[] }) =>
  Promise.resolve({ rows: [{ id: "consent-1" }] }),
);

vi.mock("@/db", () => ({
  db: {
    update: dbUpdate,
    insert: dbInsert,
    execute: dbExecute,
  },
}));

vi.mock("@/db/schema", () => ({
  notificationPreferences: {
    userId: "userId",
    pushEnabled: "pushEnabled",
    dailyReminderEnabled: "dailyReminderEnabled",
    missADayEnabled: "missADayEnabled",
    failureReasonReminderEnabled: "failureReasonReminderEnabled",
    friendRequestNotificationsEnabled: "friendRequestNotificationsEnabled",
    suppressDuringSession: "suppressDuringSession",
    dailyReminderTime: "dailyReminderTime",
    dailyReminderFrequency: "dailyReminderFrequency",
    quietHoursStart: "quietHoursStart",
    quietHoursEnd: "quietHoursEnd",
    callOptIn: "callOptIn",
    callPhoneNumber: "callPhoneNumber",
    callConsentAt: "callConsentAt",
    callWindowStart: "callWindowStart",
    callWindowStop: "callWindowStop",
    tz: "tz",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  consentEvents: {
    table: "consent_events",
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  }),
}));

const samplePrefs = {
  userId: "user-1",
  pushEnabled: true,
  dailyReminderEnabled: true,
  missADayEnabled: false,
  failureReasonReminderEnabled: false,
  friendRequestNotificationsEnabled: true,
  suppressDuringSession: false,
  dailyReminderTime: "09:00",
  dailyReminderFrequency: "daily" as const,
    quietHoursStart: null,
    quietHoursEnd: null,
    callOptIn: false,
    callPhoneNumber: null,
    callConsentAt: null,
    callWindowStart: null,
    callWindowStop: null,
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
    dbExecute.mockResolvedValue({ rows: [{ id: "consent-1" }] });
  });

function consentEventsFromExecute(): unknown[][] {
  return dbExecute.mock.calls.map((call) => call[0]?.values ?? []);
}

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

  test("PATCH updates friend request notification preference", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ friendRequestNotificationsEnabled: false }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ friendRequestNotificationsEnabled: false }),
    );
  });

  test("PATCH updates suppress-during-session preference", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ suppressDuringSession: true }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ suppressDuringSession: true }),
    );
  });

  test("PATCH updates failure reason reminder preference", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ failureReasonReminderEnabled: true }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ failureReasonReminderEnabled: true }),
    );
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

  test("PATCH rejects callOptIn without phone and window", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ callOptIn: true }),
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("PATCH sets consent timestamp when enabling call opt-in", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({
          callOptIn: true,
          callPhoneNumber: "+15551234567",
          callWindowStart: "09:00",
          callWindowStop: "17:00",
        }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        callWindowStart: "09:00",
        callWindowStop: "17:00",
      }),
    );
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty("callConsentAt");
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty("callOptIn");
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty("callPhoneNumber");
    const granted = consentEventsFromExecute()[0] ?? [];
    expect(granted).toEqual(expect.arrayContaining(["granted", "+15551234567", "preferences_api"]));
  });

  test("PATCH keeps callConsentAt and records revocation on opt-out", async () => {
    const grantedAt = new Date("2026-05-29T12:00:00.000Z");
    getOrCreateNotificationPreferences.mockResolvedValue({
      ...samplePrefs,
      callOptIn: true,
      callPhoneNumber: "+15551234567",
      callWindowStart: "09:00",
      callWindowStop: "17:00",
      callConsentAt: grantedAt,
    });

    const { PATCH } = await import("./route");

    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        headers: {
          "x-real-ip": "203.0.113.10",
          "x-forwarded-for": "198.51.100.2, 203.0.113.10",
        },
        body: JSON.stringify({ callOptIn: false }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    const update = updateSet.mock.calls[0]?.[0];
    expect(update).not.toHaveProperty("callOptIn");
    expect(update).not.toHaveProperty("callConsentAt");
    const revoked = consentEventsFromExecute()[0] ?? [];
    expect(revoked).toEqual(expect.arrayContaining([
      false,
      "revoked",
      "+15551234567",
      "preferences_api",
      "203.0.113.10",
    ]));
  });

  test("PATCH records granted, revoked, then granted without destroying earlier events", async () => {
    const { PATCH } = await import("./route");
    const patch = (body: Record<string, unknown>, ip?: string) =>
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        headers: ip ? { "x-forwarded-for": ip } : undefined,
        body: JSON.stringify(body),
      }) as NextRequest;

    getOrCreateNotificationPreferences.mockResolvedValueOnce({
      ...samplePrefs,
      callOptIn: false,
    });
    expect((await PATCH(patch({
      callOptIn: true,
      callPhoneNumber: "+15551234567",
      callWindowStart: "09:00",
      callWindowStop: "17:00",
    }, "203.0.113.10"))).status).toBe(200);

    const firstGrant = (consentEventsFromExecute()[0] ?? []).find((value) => value instanceof Date) as Date;
    getOrCreateNotificationPreferences.mockResolvedValueOnce({
      ...samplePrefs,
      callOptIn: true,
      callPhoneNumber: "+15551234567",
      callWindowStart: "09:00",
      callWindowStop: "17:00",
      callConsentAt: firstGrant,
    });
    expect((await PATCH(patch({ callOptIn: false }))).status).toBe(200);

    getOrCreateNotificationPreferences.mockResolvedValueOnce({
      ...samplePrefs,
      callOptIn: false,
      callPhoneNumber: "+15551234567",
      callWindowStart: "09:00",
      callWindowStop: "17:00",
      callConsentAt: firstGrant,
    });
    expect((await PATCH(patch({ callOptIn: true }))).status).toBe(200);

    const events = consentEventsFromExecute().map((values) =>
      values.find((value) => value === "granted" || value === "revoked"),
    );
    expect(events).toEqual(["granted", "revoked", "granted"]);
    expect(updateSet.mock.calls[1]?.[0]).not.toHaveProperty("callConsentAt");
    expect(updateSet.mock.calls[2]?.[0]).not.toHaveProperty("callConsentAt");
    expect(firstGrant).toBeInstanceOf(Date);
  });

  test("PATCH does not record another revocation when already opted out", async () => {
    getOrCreateNotificationPreferences.mockResolvedValue({
      ...samplePrefs,
      callOptIn: false,
      callPhoneNumber: "+15551234567",
      callWindowStart: "09:00",
      callWindowStop: "17:00",
      callConsentAt: new Date("2026-05-29T12:00:00.000Z"),
    });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ callOptIn: false }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(dbExecute).not.toHaveBeenCalled();
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty("callConsentAt");
  });

  test("PATCH records a new grant when the opted-in phone number changes", async () => {
    getOrCreateNotificationPreferences.mockResolvedValue({
      ...samplePrefs,
      callOptIn: true,
      callPhoneNumber: "+15551234567",
      callWindowStart: "09:00",
      callWindowStop: "17:00",
      callConsentAt: new Date("2026-05-29T12:00:00.000Z"),
    });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("http://test.local/api/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({ callPhoneNumber: "+15557654321" }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    const granted = consentEventsFromExecute()[0] ?? [];
    expect(granted).toEqual(expect.arrayContaining(["granted", "+15557654321", "preferences_api"]));
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty("callPhoneNumber");
    expect(updateSet.mock.calls[0]?.[0]).not.toHaveProperty("callConsentAt");
  });

  test("GET still returns callConsentAt as an ISO string after opt-out", async () => {
    getOrCreateNotificationPreferences.mockResolvedValue({
      ...samplePrefs,
      callOptIn: false,
      callConsentAt: new Date("2026-05-29T12:00:00.000Z"),
    });

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences.callOptIn).toBe(false);
    expect(body.preferences.callConsentAt).toBe("2026-05-29T12:00:00.000Z");
  });

  test("GET returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
