import { beforeEach, describe, expect, test, vi } from "vitest";

const hasDispatchedToday = vi.fn();
const evaluateMissADayEligibility = vi.fn();
const sendMissADayNotification = vi.fn();
const evaluateDailyReminderEligibility = vi.fn();
const sendDailyReminderNotification = vi.fn();

vi.mock("@/lib/notifications/dispatch", () => ({
  hasDispatchedToday,
}));

vi.mock("@/lib/notifications/miss-a-day", () => ({
  evaluateMissADayEligibility,
  sendMissADayNotification,
}));

vi.mock("@/lib/notifications/daily-reminder", () => ({
  evaluateDailyReminderEligibility,
  sendDailyReminderNotification,
}));

const dbSelect = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
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
  },
  users: { id: "id", currentDay: "currentDay" },
  deviceTokens: { userId: "userId", enabled: "enabled" },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => ({ and: args })),
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  exists: vi.fn((subquery) => ({ exists: subquery })),
  or: vi.fn((...args) => ({ or: args })),
}));

function mockCandidateLoad(rows: unknown[]) {
  dbSelect.mockImplementation(() => ({
    from: vi.fn((table: { enabled?: string; pushEnabled?: string }) => {
      if ("enabled" in table) {
        return { where: vi.fn().mockResolvedValue([]) };
      }
      return {
        innerJoin: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(rows),
        })),
      };
    }),
  }));
}

describe("runNotificationScheduler de-duplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCandidateLoad([
      {
        userId: "user-1",
        pushEnabled: true,
        timezone: "UTC",
        reminderTime: "09:00",
        frequency: "daily",
        quietHoursStart: null,
        quietHoursEnd: null,
        dailyReminderEnabled: true,
        missADayEnabled: true,
        currentDay: 3,
      },
    ]);
    hasDispatchedToday.mockResolvedValue(false);
    evaluateMissADayEligibility.mockResolvedValue({
      eligible: true,
      localDate: "2026-05-29",
      yesterday: "2026-05-28",
    });
    sendMissADayNotification.mockResolvedValue(true);
    evaluateDailyReminderEligibility.mockResolvedValue({
      eligible: true,
      localDate: "2026-05-29",
      title: "Still Point",
      body: "Ready when you are.",
    });
    sendDailyReminderNotification.mockResolvedValue(true);
  });

  test("miss-a-day wins over daily reminder on the same day", async () => {
    const { runNotificationScheduler } = await import("./scheduler");
    const result = await runNotificationScheduler(new Date("2026-05-29T09:02:00.000Z"));
    expect(result.missADaySent).toBe(1);
    expect(result.dailyReminderSent).toBe(0);
    expect(sendDailyReminderNotification).not.toHaveBeenCalled();
  });

  test("skips entirely when already dispatched today", async () => {
    hasDispatchedToday.mockResolvedValue(true);
    const { runNotificationScheduler } = await import("./scheduler");
    const result = await runNotificationScheduler(new Date("2026-05-29T09:02:00.000Z"));
    expect(result.missADaySent).toBe(0);
    expect(result.dailyReminderSent).toBe(0);
    expect(evaluateMissADayEligibility).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
});
