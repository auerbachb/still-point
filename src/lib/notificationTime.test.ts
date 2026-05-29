import { describe, expect, test } from "vitest";
import {
  getLocalCalendarDate,
  isPreferredTimeDue,
  isWithinQuietHours,
  wasSentOnLocalCalendarDay,
} from "./notificationTime";

describe("notificationTime", () => {
  test("isPreferredTimeDue matches a 5-minute tick window", () => {
    const at = new Date("2026-05-29T13:03:00.000Z");
    expect(isPreferredTimeDue("09:00", "America/New_York", 5, at)).toBe(true);
    expect(isPreferredTimeDue("09:10", "America/New_York", 5, at)).toBe(false);
  });

  test("isWithinQuietHours handles overnight windows", () => {
    const evening = new Date("2026-05-29T02:30:00.000Z");
    expect(isWithinQuietHours("22:00", "07:00", "America/New_York", evening)).toBe(true);

    const midday = new Date("2026-05-29T16:00:00.000Z");
    expect(isWithinQuietHours("22:00", "07:00", "America/New_York", midday)).toBe(false);
  });

  test("wasSentOnLocalCalendarDay compares user-local dates", () => {
    const tz = "America/New_York";
    const sentAt = new Date("2026-05-29T10:00:00.000Z");
    const laterSameDay = new Date("2026-05-29T22:00:00.000Z");
    const nextDay = new Date("2026-05-30T10:00:00.000Z");

    expect(wasSentOnLocalCalendarDay(sentAt, tz, laterSameDay)).toBe(true);
    expect(wasSentOnLocalCalendarDay(sentAt, tz, nextDay)).toBe(false);
    expect(getLocalCalendarDate(tz, sentAt)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
