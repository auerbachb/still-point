import { beforeEach, describe, expect, test, vi } from "vitest";

const selectWhere = vi.fn();
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));
const insertReturning = vi.fn();
const insertOnConflict = vi.fn(() => ({ returning: insertReturning }));
const insertValues = vi.fn(() => ({ onConflictDoNothing: insertOnConflict }));
const dbInsert = vi.fn(() => ({ values: insertValues }));
const sendDailyReminderNotification = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
    insert: dbInsert,
  },
}));

vi.mock("@/db/schema", () => ({
  notificationPreferences: {
    pushEnabled: "pushEnabled",
    dailyReminderEnabled: "dailyReminderEnabled",
    userId: "userId",
    tz: "tz",
    dailyReminderTime: "dailyReminderTime",
    dailyReminderFrequency: "dailyReminderFrequency",
    quietHoursStart: "quietHoursStart",
    quietHoursEnd: "quietHoursEnd",
  },
  notificationDispatches: {
    id: "id",
    userId: "userId",
    notificationType: "notificationType",
    windowKey: "windowKey",
  },
}));

vi.mock("@/lib/notifications", () => ({
  sendDailyReminderNotification,
}));

const hasMissADayDispatchForDate = vi.fn();
const userCompletedSessionOnDate = vi.fn();
const loadUserStreak = vi.fn();

vi.mock("@/lib/notifications/daily-reminder", () => ({
  hasMissADayDispatchForDate,
  userCompletedSessionOnDate,
  loadUserStreak,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => ({ and: args })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

describe("notification scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    sendDailyReminderNotification.mockResolvedValue(undefined);
    insertReturning.mockResolvedValue([{ id: "dispatch-1" }]);
    hasMissADayDispatchForDate.mockResolvedValue(false);
    userCompletedSessionOnDate.mockResolvedValue(false);
    loadUserStreak.mockResolvedValue(0);
  });

  test("claimNotificationDispatch is idempotent on conflict", async () => {
    insertReturning.mockResolvedValueOnce([{ id: "first" }]).mockResolvedValueOnce([]);

    const { claimNotificationDispatch } = await import("./notification-scheduler");

    const first = await claimNotificationDispatch({
      userId: "user-1",
      notificationType: "daily_reminder",
      windowKey: "2026-05-29",
    });
    const second = await claimNotificationDispatch({
      userId: "user-1",
      notificationType: "daily_reminder",
      windowKey: "2026-05-29",
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  test("dispatchDueNotifications sends once when reminder window matches", async () => {
    selectWhere.mockResolvedValue([
      {
        userId: "user-1",
        tz: "UTC",
        dailyReminderTime: "09:00",
        dailyReminderFrequency: "daily",
        quietHoursStart: null,
        quietHoursEnd: null,
      },
    ]);

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const now = new Date("2026-05-29T09:02:00.000Z");

    const first = await dispatchDueNotifications(now);
    insertReturning.mockResolvedValueOnce([]);
    const second = await dispatchDueNotifications(now);

    expect(first.sent).toBe(1);
    expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
    expect(second.sent).toBe(0);
  });

  test("isWithinCronWindow does not wrap across midnight", async () => {
    const { isoWeekPartsFromDateKey } = await import("./notification-scheduler");
    const lateDecember = isoWeekPartsFromDateKey("2025-12-29");
    expect(lateDecember.isoYear).toBe(2026);
    expect(lateDecember.week).toBe("01");
  });

  test("dispatchDueNotifications skips quiet hours", async () => {
    selectWhere.mockResolvedValue([
      {
        userId: "user-1",
        tz: "UTC",
        dailyReminderTime: "09:00",
        dailyReminderFrequency: "daily",
        quietHoursStart: "08:00",
        quietHoursEnd: "10:00",
      },
    ]);

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T09:02:00.000Z"));

    expect(result.sent).toBe(0);
    expect(sendDailyReminderNotification).not.toHaveBeenCalled();
  });
});
