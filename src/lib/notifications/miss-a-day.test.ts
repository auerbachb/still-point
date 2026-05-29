import { beforeEach, describe, expect, test, vi } from "vitest";
import type { NotificationTickCandidate } from "@/lib/notifications/types";

const userCompletedSessionOnDate = vi.fn();
const sendPushNotificationToUser = vi.fn();
const recordDispatch = vi.fn();

vi.mock("@/lib/notifications/meditation", () => ({
  userCompletedSessionOnDate,
}));

vi.mock("@/lib/notifications", () => ({
  sendPushNotificationToUser,
}));

vi.mock("@/lib/notifications/dispatch", () => ({
  recordDispatch,
}));

const basePrefs: NotificationTickCandidate = {
  userId: "user-1",
  pushEnabled: true,
  timezone: "UTC",
  reminderTime: "09:00",
  frequency: "daily",
  quietHoursStart: null,
  quietHoursEnd: null,
  dailyReminderEnabled: true,
  missADayEnabled: true,
  currentDay: 5,
};

describe("evaluateMissADayEligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userCompletedSessionOnDate.mockResolvedValue(false);
  });

  test("eligible when yesterday missed, not meditated today, at reminder time", async () => {
    const now = new Date("2026-05-29T09:02:00.000Z");
    const { evaluateMissADayEligibility } = await import("./miss-a-day");
    const result = await evaluateMissADayEligibility(basePrefs, now);
    expect(result).toEqual({
      eligible: true,
      localDate: "2026-05-29",
      yesterday: "2026-05-28",
    });
    expect(userCompletedSessionOnDate).toHaveBeenCalledTimes(2);
  });

  test("not eligible when user already meditated today", async () => {
    userCompletedSessionOnDate.mockImplementation(async ({ localDate }) => localDate === "2026-05-29");
    const now = new Date("2026-05-29T09:02:00.000Z");
    const { evaluateMissADayEligibility } = await import("./miss-a-day");
    const result = await evaluateMissADayEligibility(basePrefs, now);
    expect(result).toEqual({ eligible: false, reason: "meditated_today" });
  });

  test("not eligible when user completed yesterday", async () => {
    userCompletedSessionOnDate.mockImplementation(async ({ localDate }) => localDate === "2026-05-28");
    const now = new Date("2026-05-29T09:02:00.000Z");
    const { evaluateMissADayEligibility } = await import("./miss-a-day");
    const result = await evaluateMissADayEligibility(basePrefs, now);
    expect(result).toEqual({ eligible: false, reason: "completed_yesterday" });
  });

  test("respects quiet hours", async () => {
    const prefs = {
      ...basePrefs,
      quietHoursStart: "08:00",
      quietHoursEnd: "12:00",
    };
    const now = new Date("2026-05-29T09:02:00.000Z");
    const { evaluateMissADayEligibility } = await import("./miss-a-day");
    const result = await evaluateMissADayEligibility(prefs, now);
    expect(result).toEqual({ eligible: false, reason: "quiet_hours" });
  });
});

describe("sendMissADayNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordDispatch.mockResolvedValue(true);
    sendPushNotificationToUser.mockResolvedValue({ delivered: true });
  });

  test("sends quick-minute deep link payload", async () => {
    const { sendMissADayNotification, MISS_A_DAY_DEEP_LINK } = await import("./miss-a-day");
    const sent = await sendMissADayNotification({ userId: "user-1", localDate: "2026-05-29" });
    expect(sent).toBe(true);
    expect(recordDispatch).toHaveBeenCalled();
    expect(sendPushNotificationToUser).toHaveBeenCalledWith({
      recipientUserId: "user-1",
      payload: expect.objectContaining({
        type: "miss_a_day",
        deepLink: MISS_A_DAY_DEEP_LINK,
        aps: expect.objectContaining({
          alert: expect.objectContaining({
            body: expect.stringMatching(/quick 1-min/i),
          }),
        }),
      }),
    });
  });
});
