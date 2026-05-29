import { describe, expect, test } from "vitest";
import {
  buildDailyReminderPayload,
  evaluateDailyReminderEligibility,
  SCHEDULER_TICK_MINUTES,
  type DailyReminderPreferenceRow,
} from "./daily-reminder";

function basePreference(overrides: Partial<DailyReminderPreferenceRow> = {}): DailyReminderPreferenceRow {
  return {
    userId: "user-1",
    enabled: true,
    dailyReminderEnabled: true,
    preferredTime: "09:00",
    frequency: "daily",
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: "America/New_York",
    lastDailyReminderSentAt: null,
    lastMissADaySentAt: null,
    createdAt: new Date("2026-01-01T12:00:00.000Z"),
    ...overrides,
  };
}

describe("evaluateDailyReminderEligibility", () => {
  const dueNow = new Date("2026-05-29T13:02:00.000Z");

  test("is eligible at preferred time when no blockers", () => {
    const result = evaluateDailyReminderEligibility({
      preference: basePreference(),
      hasCompletedSessionToday: false,
      streak: 1,
      now: dueNow,
      tickMinutes: SCHEDULER_TICK_MINUTES,
    });
    expect(result).toEqual({ eligible: true });
  });

  test("skips when user already meditated today", () => {
    const result = evaluateDailyReminderEligibility({
      preference: basePreference(),
      hasCompletedSessionToday: true,
      streak: 5,
      now: dueNow,
    });
    expect(result).toEqual({ eligible: false, reason: "meditated_today" });
  });

  test("skips during quiet hours", () => {
    const result = evaluateDailyReminderEligibility({
      preference: basePreference({ quietHoursStart: "22:00", quietHoursEnd: "07:00" }),
      hasCompletedSessionToday: false,
      streak: 1,
      now: new Date("2026-05-29T02:30:00.000Z"),
    });
    expect(result).toEqual({ eligible: false, reason: "quiet_hours" });
  });

  test("preflight skips expensive gates until session data is loaded", () => {
    const result = evaluateDailyReminderEligibility({
      preference: basePreference(),
      hasCompletedSessionToday: true,
      streak: 10,
      now: dueNow,
      preflightOnly: true,
    });
    expect(result).toEqual({ eligible: true });
  });

  test("skips when daily reminder toggle is off", () => {
    const result = evaluateDailyReminderEligibility({
      preference: basePreference({ dailyReminderEnabled: false }),
      hasCompletedSessionToday: false,
      streak: 1,
      now: dueNow,
    });
    expect(result).toEqual({ eligible: false, reason: "daily_reminder_disabled" });
  });

  test("skips when miss-a-day already sent today (de-dup #247)", () => {
    const result = evaluateDailyReminderEligibility({
      preference: basePreference({
        lastMissADaySentAt: new Date("2026-05-29T12:00:00.000Z"),
      }),
      hasCompletedSessionToday: false,
      streak: 1,
      now: dueNow,
    });
    expect(result).toEqual({ eligible: false, reason: "miss_a_day_sent_today" });
  });

  test("skips when already sent today", () => {
    const result = evaluateDailyReminderEligibility({
      preference: basePreference({
        lastDailyReminderSentAt: new Date("2026-05-29T12:00:00.000Z"),
      }),
      hasCompletedSessionToday: false,
      streak: 1,
      now: dueNow,
    });
    expect(result).toEqual({ eligible: false, reason: "already_sent_today" });
  });
});

describe("buildDailyReminderPayload", () => {
  test("uses streak copy when streak > 3", () => {
    const payload = buildDailyReminderPayload(4);
    expect(payload.aps.alert.body).toContain("Day 4 of your streak");
    expect(payload.type).toBe("daily_reminder");
    expect(payload.deepLink).toBe("stillpoint://home");
  });

  test("uses default copy for short streaks", () => {
    const payload = buildDailyReminderPayload(3);
    expect(payload.aps.alert.body).toContain("stillness");
  });
});
