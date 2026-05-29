import { describe, expect, test } from "vitest";
import {
  addCalendarDays,
  isInQuietHours,
  isReminderDueNow,
  localCalendarDate,
} from "./time";

describe("notification time helpers", () => {
  test("localCalendarDate uses the user's timezone", () => {
    const now = new Date("2026-05-29T04:30:00.000Z");
    expect(localCalendarDate(now, "America/New_York")).toBe("2026-05-29");
    expect(localCalendarDate(now, "Asia/Tokyo")).toBe("2026-05-29");
  });

  test("isReminderDueNow matches a five-minute cron window", () => {
    const now = new Date("2026-05-29T09:03:00.000Z");
    expect(isReminderDueNow({
      now,
      timeZone: "UTC",
      reminderTime: "09:00",
    })).toBe(true);
    expect(isReminderDueNow({
      now: new Date("2026-05-29T09:06:00.000Z"),
      timeZone: "UTC",
      reminderTime: "09:00",
    })).toBe(false);
  });

  test("isReminderDueNow handles windows that cross local midnight", () => {
    const now = new Date("2026-05-30T00:01:00.000Z");
    expect(isReminderDueNow({
      now,
      timeZone: "UTC",
      reminderTime: "23:58",
      tickWindowMinutes: 5,
    })).toBe(true);
  });

  test("isInQuietHours handles windows spanning midnight", () => {
    const now = new Date("2026-05-29T23:30:00.000Z");
    expect(isInQuietHours({
      now,
      timeZone: "UTC",
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    })).toBe(true);
  });

  test("addCalendarDays steps backward for yesterday", () => {
    expect(addCalendarDays("2026-05-29", -1)).toBe("2026-05-28");
  });
});
