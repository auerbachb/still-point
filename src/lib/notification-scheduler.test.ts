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
const sendFailureReasonReminderNotification = vi.fn();

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
  failureReasons: { table: "failure_reasons" },
}));

vi.mock("@/lib/notifications", () => ({
  sendDailyReminderNotification,
  sendMissADayNotification,
  sendFailureReasonReminderNotification,
}));

const hasMissADayDispatchForDate = vi.fn();
const userCompletedSessionOnDate = vi.fn();
const loadUserStreak = vi.fn();

vi.mock("@/lib/notifications/daily-reminder", () => ({
  hasMissADayDispatchForDate,
  userCompletedSessionOnDate,
  loadUserStreak,
}));

const hasFailureReasonForDate = vi.fn();

vi.mock("@/lib/notifications/failure-reason", () => ({
  FAILURE_REASON_NOTIFICATION_TYPE: "failure_reason_reminder",
  FAILURE_REASON_REMINDER_MINUTES: 20 * 60,
  hasFailureReasonForDate,
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
  failureReasonReminderEnabled: false,
};

describe("notification scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    preferenceRows = [basePrefs];
    sendDailyReminderNotification.mockReset();
    sendMissADayNotification.mockReset();
    sendFailureReasonReminderNotification.mockReset();
    sendDailyReminderNotification.mockResolvedValue({ delivered: true });
    sendMissADayNotification.mockResolvedValue({ delivered: true });
    sendFailureReasonReminderNotification.mockResolvedValue({ delivered: true });
    insertReturning.mockReset();
    insertReturning.mockResolvedValue([{ id: "dispatch-1" }]);
    hasMissADayDispatchForDate.mockResolvedValue(false);
    userCompletedSessionOnDate.mockResolvedValue(false);
    hasFailureReasonForDate.mockResolvedValue(false);
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
  test("failure-reason reminder asks about yesterday first at 8 PM local (#441)", async () => {
    preferenceRows = [{
      ...basePrefs,
      dailyReminderEnabled: false,
      missADayEnabled: false,
      failureReasonReminderEnabled: true,
    }];

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T20:02:00.000Z"));

    expect(result.failureReasonSent).toBe(1);
    expect(sendFailureReasonReminderNotification).toHaveBeenCalledWith({
      recipientUserId: "user-1",
      targetDate: "2026-05-28",
      isYesterday: true,
    });
  });

  test("failure-reason send short-circuits daily accounting for the same candidate (#441)", async () => {
    preferenceRows = [{
      ...basePrefs,
      dailyReminderTime: "20:00",
      failureReasonReminderEnabled: true,
    }];

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T20:02:00.000Z"));

    expect(result.sent).toBe(1);
    expect(result.failureReasonSent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(sendFailureReasonReminderNotification).toHaveBeenCalledTimes(1);
    expect(sendDailyReminderNotification).not.toHaveBeenCalled();
  });

  test("failure-reason send is not also counted as skipped when daily window is not due (#441)", async () => {
    preferenceRows = [{
      ...basePrefs,
      dailyReminderEnabled: true,
      dailyReminderTime: "09:00",
      missADayEnabled: false,
      failureReasonReminderEnabled: true,
    }];

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T20:02:00.000Z"));

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failureReasonSent).toBe(1);
    expect(sendFailureReasonReminderNotification).toHaveBeenCalledWith({
      recipientUserId: "user-1",
      targetDate: "2026-05-28",
      isYesterday: true,
    });
    expect(sendDailyReminderNotification).not.toHaveBeenCalled();
  });

  test("failure-reason reminder falls back to today when yesterday is handled (#441)", async () => {
    preferenceRows = [{
      ...basePrefs,
      dailyReminderEnabled: false,
      missADayEnabled: false,
      failureReasonReminderEnabled: true,
    }];
    // Sat yesterday, nothing today.
    userCompletedSessionOnDate.mockImplementation(async (_userId, date) => date === "2026-05-28");

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T20:02:00.000Z"));

    expect(result.failureReasonSent).toBe(1);
    expect(sendFailureReasonReminderNotification).toHaveBeenCalledWith({
      recipientUserId: "user-1",
      targetDate: "2026-05-29",
      isYesterday: false,
    });
  });

  test("failure-reason reminder is skipped when both days are already covered (#441)", async () => {
    preferenceRows = [{
      ...basePrefs,
      dailyReminderEnabled: false,
      missADayEnabled: false,
      failureReasonReminderEnabled: true,
    }];
    userCompletedSessionOnDate.mockResolvedValue(true);

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T20:02:00.000Z"));

    expect(result.failureReasonSent).toBe(0);
    expect(sendFailureReasonReminderNotification).not.toHaveBeenCalled();
  });

  test("failure-reason reminder does not fire outside the fixed 8 PM window (#441)", async () => {
    preferenceRows = [{
      ...basePrefs,
      dailyReminderEnabled: false,
      missADayEnabled: false,
      failureReasonReminderEnabled: true,
    }];

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T09:02:00.000Z"));

    expect(result.failureReasonSent).toBe(0);
    expect(sendFailureReasonReminderNotification).not.toHaveBeenCalled();
  });

  test("failure-reason reminder is idempotent for the firing day (#441)", async () => {
    preferenceRows = [{
      ...basePrefs,
      dailyReminderEnabled: false,
      missADayEnabled: false,
      failureReasonReminderEnabled: true,
    }];

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const first = await dispatchDueNotifications(new Date("2026-05-29T20:00:00.000Z"));
    // Adjacent boundary run: the claim already exists -> no second send.
    insertReturning.mockResolvedValueOnce([]);
    const second = await dispatchDueNotifications(new Date("2026-05-29T20:05:00.000Z"));

    expect(first.failureReasonSent).toBe(1);
    expect(second.failureReasonSent).toBe(0);
    expect(sendFailureReasonReminderNotification).toHaveBeenCalledTimes(1);
  });

  test("failure-reason send exception releases the claim instead of blocking the day (#441)", async () => {
    preferenceRows = [{
      ...basePrefs,
      dailyReminderEnabled: false,
      missADayEnabled: false,
      failureReasonReminderEnabled: true,
    }];
    sendFailureReasonReminderNotification.mockRejectedValueOnce(new Error("APNs exploded"));

    const { dispatchDueNotifications } = await import("./notification-scheduler");
    const result = await dispatchDueNotifications(new Date("2026-05-29T20:02:00.000Z"));

    expect(result.failureReasonSent).toBe(0);
    expect(dbDelete).toHaveBeenCalled();
  });

  test("weekly 23:55 reminder sends on cross-midnight 00:00 run (#440 frequency gate)", async () => {
    // 2026-05-25 is a Monday (dayIndex 1). A weekly reminder at 23:55 is covered by
    // both the 23:55 run (delta=0) and the next-day 00:00 run (delta=5). Before this fix
    // frequencyAllowsSend used local (Tuesday's dayIndex=2) instead of intendedDateKey
    // (Monday), causing the midnight catch-up run to skip the send entirely.
    preferenceRows = [{ ...basePrefs, dailyReminderTime: "23:55", dailyReminderFrequency: "weekly" }];
    const { dispatchDueNotifications } = await import("./notification-scheduler");

    // Simulate only the midnight catch-up run (23:55 run missed / no claim yet).
    const result = await dispatchDueNotifications(new Date("2026-05-26T00:00:00.000Z")); // Tuesday 00:00 UTC

    expect(result.sent).toBe(1);
    expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
  });

  describe("quiet-hours boundary (#561)", () => {
    test("isInQuietHours: overnight end is exclusive at 08:00", async () => {
      const { isInQuietHours } = await import("./notification-scheduler");
      const quiet = { start: "22:00", end: "08:00" } as const;

      expect(isInQuietHours(7 * 60 + 59, quiet.start, quiet.end)).toBe(true);
      expect(isInQuietHours(8 * 60, quiet.start, quiet.end)).toBe(false);
    });

    test("isInQuietHours: default iOS window 22:00–07:00 treats 07:59 as outside quiet", async () => {
      const { isInQuietHours } = await import("./notification-scheduler");
      const quiet = { start: "22:00", end: "07:00" } as const;

      expect(isInQuietHours(6 * 60 + 59, quiet.start, quiet.end)).toBe(true);
      expect(isInQuietHours(7 * 60, quiet.start, quiet.end)).toBe(false);
      expect(isInQuietHours(7 * 60 + 59, quiet.start, quiet.end)).toBe(false);
    });

    test("evaluateReminderDispatchWindow defers a 07:54 reminder until quiet ends at 08:00", async () => {
      const { evaluateReminderDispatchWindow } = await import("./notification-scheduler");
      const reminder = 7 * 60 + 54;
      const quiet = { start: "22:00", end: "08:00" } as const;

      expect(evaluateReminderDispatchWindow(7 * 60 + 54, reminder, quiet.start, quiet.end)).toEqual({
        due: false,
        dayOffset: 0,
      });
      expect(evaluateReminderDispatchWindow(7 * 60 + 59, reminder, quiet.start, quiet.end)).toEqual({
        due: false,
        dayOffset: 0,
      });
      expect(evaluateReminderDispatchWindow(8 * 60, reminder, quiet.start, quiet.end)).toEqual({
        due: true,
        dayOffset: 0,
      });
    });

    test("evaluateReminderDispatchWindow still delivers a 07:59 reminder on the 08:00 tick", async () => {
      const { evaluateReminderDispatchWindow } = await import("./notification-scheduler");
      const reminder = 7 * 60 + 59;
      const quiet = { start: "22:00", end: "08:00" } as const;

      expect(evaluateReminderDispatchWindow(7 * 60 + 59, reminder, quiet.start, quiet.end)).toEqual({
        due: false,
        dayOffset: 0,
      });
      expect(evaluateReminderDispatchWindow(8 * 60, reminder, quiet.start, quiet.end)).toEqual({
        due: true,
        dayOffset: 0,
      });
    });

    test("dispatchDueNotifications delivers after quiet hours when the normal window expired (#561)", async () => {
      preferenceRows = [{
        ...basePrefs,
        dailyReminderTime: "07:54",
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
      }];

      const { dispatchDueNotifications } = await import("./notification-scheduler");

      const blocked = await dispatchDueNotifications(new Date("2026-05-29T07:59:00.000Z"));
      expect(blocked.sent).toBe(0);
      expect(sendDailyReminderNotification).not.toHaveBeenCalled();

      const delivered = await dispatchDueNotifications(new Date("2026-05-29T08:00:00.000Z"));
      expect(delivered.sent).toBe(1);
      expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
    });

    test("dispatchDueNotifications does not defer past CRON_WINDOW_MINUTES after quiet end", async () => {
      preferenceRows = [{
        ...basePrefs,
        dailyReminderTime: "07:45",
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
      }];

      const { dispatchDueNotifications } = await import("./notification-scheduler");
      const result = await dispatchDueNotifications(new Date("2026-05-29T08:06:00.000Z"));

      expect(result.sent).toBe(0);
      expect(sendDailyReminderNotification).not.toHaveBeenCalled();
    });
  });

  describe("America/New_York DST (#561)", () => {
    test("dispatchDueNotifications matches 08:00 local on spring-forward day", async () => {
      preferenceRows = [{ ...basePrefs, tz: "America/New_York", dailyReminderTime: "08:00" }];
      const { dispatchDueNotifications } = await import("./notification-scheduler");
      // 2026-03-08 08:02 EDT (UTC-4 after 2 AM spring-forward) = 12:02 UTC
      const result = await dispatchDueNotifications(new Date("2026-03-08T12:02:00.000Z"));

      expect(result.sent).toBe(1);
      expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
    });

    test("dispatchDueNotifications matches 08:00 local on fall-back day", async () => {
      preferenceRows = [{ ...basePrefs, tz: "America/New_York", dailyReminderTime: "08:00" }];
      const { dispatchDueNotifications } = await import("./notification-scheduler");
      // 2026-11-01 08:02 EST (UTC-5 after 2 AM fall-back) = 13:02 UTC
      const result = await dispatchDueNotifications(new Date("2026-11-01T13:02:00.000Z"));

      expect(result.sent).toBe(1);
      expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
    });

    test("quiet-hours deferral works in America/New_York across DST", async () => {
      preferenceRows = [{
        ...basePrefs,
        tz: "America/New_York",
        dailyReminderTime: "07:54",
        quietHoursStart: "22:00",
        quietHoursEnd: "08:00",
      }];
      const { dispatchDueNotifications } = await import("./notification-scheduler");
      // 2026-03-08 08:00 EDT = 12:00 UTC
      const result = await dispatchDueNotifications(new Date("2026-03-08T12:00:00.000Z"));

      expect(result.sent).toBe(1);
      expect(sendDailyReminderNotification).toHaveBeenCalledTimes(1);
    });
  });


});
