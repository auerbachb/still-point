import { beforeEach, describe, expect, test, vi } from "vitest";

let preferenceRows: Array<Record<string, unknown>> = [];
let limitQueryResults: Array<Array<{ id: string }>> = [];
let limitQueryIndex = 0;
let dbSelectCall = 0;

const insertReturning = vi.fn();
const insertOnConflict = vi.fn(() => ({ returning: insertReturning }));
const insertValues = vi.fn(() => ({ onConflictDoNothing: insertOnConflict }));
const dbInsert = vi.fn(() => ({ values: insertValues }));
const deleteWhere = vi.fn().mockResolvedValue(undefined);
const dbDelete = vi.fn(() => ({ where: deleteWhere }));
const sendDailyReminderNotification = vi.fn();
const sendMissADayNotification = vi.fn();

const dbSelect = vi.fn(() => {
  dbSelectCall += 1;
  if (dbSelectCall === 1) {
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(preferenceRows)),
      })),
    };
  }
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve(nextLimitResult())),
      })),
    })),
  };
});

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
    insert: dbInsert,
    delete: dbDelete,
  },
}));

vi.mock("@/db/schema", () => ({
  notificationPreferences: { table: "notification_preferences" },
  notificationDispatches: { table: "notification_dispatches" },
  sessions: { table: "sessions" },
}));

vi.mock("@/lib/notifications", () => ({
  sendDailyReminderNotification,
  sendMissADayNotification,
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
  or: vi.fn((...args) => ({ or: args })),
}));

const basePrefs = {
  userId: "user-1",
  tz: "UTC",
  dailyReminderTime: "09:00",
  dailyReminderFrequency: "daily",
  quietHoursStart: null,
  quietHoursEnd: null,
  dailyReminderEnabled: true,
  missADayEnabled: false,
};

function queueLimitResults(...results: Array<Array<{ id: string }>>) {
  limitQueryResults = results;
  limitQueryIndex = 0;
}

function nextLimitResult(): Array<{ id: string }> {
  const result = limitQueryResults[limitQueryIndex] ?? [];
  limitQueryIndex += 1;
  return result;
}

describe("notification scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    dbSelectCall = 0;
    preferenceRows = [basePrefs];
    queueLimitResults([]);
    sendDailyReminderNotification.mockReset();
    sendMissADayNotification.mockReset();
    sendDailyReminderNotification.mockResolvedValue(undefined);
    sendMissADayNotification.mockResolvedValue({ delivered: true });
    insertReturning.mockReset();
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

  test("dispatchDueNotifications sends daily reminder when window matches", async () => {
    queueLimitResults([]);

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const now = new Date("2026-05-29T09:02:00.000Z");

    const first = await dispatchDueNotifications(now);
    dbSelectCall = 0;
    queueLimitResults([{ id: "existing-dispatch" }]);
    insertReturning.mockResolvedValueOnce([]);
    const second = await dispatchDueNotifications(now);

    expect(first.sent).toBe(1);
    expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
    expect(second.sent).toBe(0);
  });

  test("dispatchDueNotifications sends miss-a-day when yesterday was missed", async () => {
    preferenceRows = [{ ...basePrefs, missADayEnabled: true, dailyReminderEnabled: false }];
    queueLimitResults([]);
    userCompletedSessionOnDate.mockResolvedValue(false);

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T09:02:00.000Z"));

    expect(result.missADaySent).toBe(1);
    expect(sendMissADayNotification).toHaveBeenCalledWith({ recipientUserId: "user-1" });
    expect(sendDailyReminderNotification).not.toHaveBeenCalled();
  });

  test("dispatchDueNotifications skips miss-a-day when user meditated today", async () => {
    preferenceRows = [{ ...basePrefs, missADayEnabled: true, dailyReminderEnabled: false }];
    queueLimitResults([]);
    userCompletedSessionOnDate.mockImplementation(async (_userId, date) => date === "2026-05-29");

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T09:02:00.000Z"));

    expect(result.missADaySent).toBe(0);
    expect(sendMissADayNotification).not.toHaveBeenCalled();
  });

  test("isoWeekPartsFromDateKey handles year boundary", async () => {
    const { isoWeekPartsFromDateKey } = await import("./notification-scheduler");
    const lateDecember = isoWeekPartsFromDateKey("2025-12-29");
    expect(lateDecember.isoYear).toBe(2026);
    expect(lateDecember.week).toBe("01");
  });

  test("dispatchDueNotifications skips quiet hours", async () => {
    preferenceRows = [
      {
        ...basePrefs,
        quietHoursStart: "08:00",
        quietHoursEnd: "10:00",
      },
    ];

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T09:02:00.000Z"));

    expect(result.sent).toBe(0);
    expect(sendDailyReminderNotification).not.toHaveBeenCalled();
    expect(sendMissADayNotification).not.toHaveBeenCalled();
  });
});
