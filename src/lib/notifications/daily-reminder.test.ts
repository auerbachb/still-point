import { describe, expect, test } from "vitest";
import {
  buildDailyReminderPayload,
  streakFromSessions,
} from "./daily-reminder";

describe("daily reminder helpers", () => {
  test("buildDailyReminderPayload uses default copy for short streaks", () => {
    const payload = buildDailyReminderPayload(2);
    expect(payload.aps.alert).toMatchObject({
      title: "Still Point",
      body: "Time for a moment of stillness. Tap to begin.",
    });
    expect(payload.type).toBe("daily_reminder");
    expect(payload.deepLink).toBe("stillpoint://home");
  });

  test("buildDailyReminderPayload uses streak copy when streak > 3", () => {
    const payload = buildDailyReminderPayload(5);
    expect(payload.aps.alert).toMatchObject({
      body: "Day 5 of your streak — keep it going.",
    });
  });

  test("streakFromSessions returns calculated streak", () => {
    const streak = streakFromSessions([
      {
        sessionType: "standard",
        dayNumber: 1,
        duration: 600,
        bonusSeconds: 0,
        completed: true,
        clearPercent: 100,
        thoughtCount: 0,
        sessionDate: "2026-05-28",
        createdAt: new Date("2026-05-28T12:00:00.000Z"),
      },
      {
        sessionType: "standard",
        dayNumber: 2,
        duration: 600,
        bonusSeconds: 0,
        completed: true,
        clearPercent: 100,
        thoughtCount: 0,
        sessionDate: "2026-05-29",
        createdAt: new Date("2026-05-29T12:00:00.000Z"),
      },
    ]);
    expect(streak).toBeGreaterThanOrEqual(1);
  });
});
