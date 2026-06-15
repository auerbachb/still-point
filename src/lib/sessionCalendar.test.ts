import { afterEach, describe, expect, test, vi } from "vitest";
import { todayLocalIsoDate, isValidSessionCalendarDate } from "./sessionCalendar";

describe("todayLocalIsoDate", () => {
  afterEach(() => vi.useRealTimers());

  test("formats the local calendar day as zero-padded YYYY-MM-DD", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 10, 30, 0)); // local Jan 5, 2026
    expect(todayLocalIsoDate()).toBe("2026-01-05");
  });

  test("reports the local calendar day late in the evening (no UTC rollover)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 0)); // local Dec 31, 2026
    expect(todayLocalIsoDate()).toBe("2026-12-31");
    expect(isValidSessionCalendarDate(todayLocalIsoDate())).toBe(true);
  });
});
