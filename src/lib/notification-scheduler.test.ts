import { beforeEach, describe, expect, test, vi } from "vitest";

let preferenceRows: Array<Record<string, unknown>> = [];

const insertReturning = vi.fn();
const insertOnConflict = vi.fn(() => ({ returning: insertReturning }));
const insertValues = vi.fn(() => ({ onConflictDoNothing: insertOnConflict }));
const dbInsert = vi.fn(() => ({ values: insertValues }));
const deleteWhere = vi.fn().mockResolvedValue(undefined);
const dbDelete = vi.fn(() => ({ where: deleteWhere }));
const sendDailyReminderNotification = vi.fn();
const sendMissADayNotification = vi.fn();

const dbSelect = vi.fn(() => ({
  from: vi.fn(() => ({
    where: vi.fn(() => Promise.resolve(preferenceRows)),
  })),
}));

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

describe("notification scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    preferenceRows = [basePrefs];
    sendDailyReminderNotification.mockReset();
    sendMissADayNotification.mockReset();
    sendDailyReminderNotification.mockResolvedValue({ delivered: true });
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
    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const now = new Date("2026-05-29T09:02:00.000Z");

    const first = await dispatchDueNotifications(now);
    insertReturning.mockResolvedValueOnce([]);
    const second = await dispatchDueNotifications(now);

    expect(first.sent).toBe(1);
    expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
    expect(second.sent).toBe(0);
  });

  test("sends a due reminder at the cron window boundary minute (#440 off-by-one)", async () => {
    const { dispatchDueNotifications } = await import("./notification-scheduler");
    // reminder 09:00, run at 09:05 => delta === CRON_WINDOW_MINUTES (the boundary that
    // was previously dropped by the exclusive `<` comparison).
    const result = await dispatchDueNotifications(new Date("2026-05-29T09:05:00.000Z"));

    expect(result.sent).toBe(1);
    expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
  });

  test("idempotency still prevents double-sends across overlapping boundary runs (#440)", async () => {
    const { dispatchDueNotifications } = await import("./notification-scheduler");

    // First run at delta 0 claims and sends.
    const first = await dispatchDueNotifications(new Date("2026-05-29T09:00:00.000Z"));
    // Adjacent run that now also matches the same reminder at the boundary minute. The
    // claim row already exists, so onConflictDoNothing returns no row -> no second send.
    insertReturning.mockResolvedValueOnce([]);
    const second = await dispatchDueNotifications(new Date("2026-05-29T09:05:00.000Z"));

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
  });

  test("midnight-boundary: 23:55 reminder does not double-send across the date change (#440)", async () => {
    // Reproduce the CodeAnt finding: a reminder at 23:55 is covered both by the 23:55
    // run (delta=0, windowKey="2026-05-29") and by the 00:00 run (delta=5, still <=
    // CRON_WINDOW_MINUTES). Before the dayOffset fix the 00:00 run used windowKey
    // "2026-05-30", bypassing the existing claimNotificationDispatch deduplication and
    // triggering a second send minutes after the first.
    preferenceRows = [{ ...basePrefs, dailyReminderTime: "23:55" }];
    const { dispatchDueNotifications } = await import("./notification-scheduler");

    // 23:55 run — delta=0, intendedDateKey="2026-05-29", claims + sends.
    const first = await dispatchDueNotifications(new Date("2026-05-29T23:55:00.000Z"));

    // 00:00 next-day run — delta=5, intendedDateKey must still be "2026-05-29" (the
    // reminder's intended date). The claim row already exists, so no second send.
    insertReturning.mockResolvedValueOnce([]);
    const second = await dispatchDueNotifications(new Date("2026-05-30T00:00:00.000Z"));

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
  });

  test("miss-a-day send exception releases the claim instead of blocking the user (#440)", async () => {
    preferenceRows = [{ ...basePrefs, missADayEnabled: true, dailyReminderEnabled: false }];
    userCompletedSessionOnDate.mockResolvedValue(false);
    sendMissADayNotification.mockRejectedValueOnce(new Error("APNs exploded"));

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T09:02:00.000Z"));

    // The run completes without throwing and nothing was marked sent...
    expect(result.missADaySent).toBe(0);
    // ...but the claim is rolled back so a later run can retry.
    expect(dbDelete).toHaveBeenCalled();
  });

  test("dispatchDueNotifications sends miss-a-day when yesterday was missed", async () => {
    preferenceRows = [{ ...basePrefs, missADayEnabled: true, dailyReminderEnabled: false }];
    userCompletedSessionOnDate.mockResolvedValue(false);

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T09:02:00.000Z"));

    expect(result.missADaySent).toBe(1);
    expect(sendMissADayNotification).toHaveBeenCalledWith({ recipientUserId: "user-1" });
    expect(sendDailyReminderNotification).not.toHaveBeenCalled();
  });

  test("dispatchDueNotifications skips miss-a-day when user meditated today", async () => {
    preferenceRows = [{ ...basePrefs, missADayEnabled: true, dailyReminderEnabled: false }];
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
