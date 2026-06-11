import { describe, expect, test } from "vitest";
import { BASE_DURATION } from "@/lib/constants";
import {
  calendarDaysUntilUTC,
  normalizedBuddySessionDurationSeconds,
  projectedCalendarDurationSeconds,
} from "@/lib/buddySessionDuration";

describe("normalizedBuddySessionDurationSeconds", () => {
  test("two participants uses the shorter current-day length", () => {
    expect(normalizedBuddySessionDurationSeconds([1, 5])).toBe(60);
    expect(normalizedBuddySessionDurationSeconds([5, 1])).toBe(60);
    expect(normalizedBuddySessionDurationSeconds([3, 3])).toBe(80);
  });

  test("three participants uses minimum across the group", () => {
    expect(normalizedBuddySessionDurationSeconds([1, 3, 7])).toBe(60);
    expect(normalizedBuddySessionDurationSeconds([4, 2, 6])).toBe(70);
  });

  test("many participants still picks the global minimum", () => {
    const days = [10, 2, 8, 4, 15, 1, 6];
    expect(normalizedBuddySessionDurationSeconds(days)).toBe(60);
    expect(normalizedBuddySessionDurationSeconds([10, 11, 12, 13])).toBe(150);
  });

  test("floors at one minute when all participants are on day 1", () => {
    expect(normalizedBuddySessionDurationSeconds([1])).toBe(BASE_DURATION);
    expect(normalizedBuddySessionDurationSeconds([1, 1, 1])).toBe(BASE_DURATION);
  });

  test("empty participant list defaults to base duration", () => {
    expect(normalizedBuddySessionDurationSeconds([])).toBe(BASE_DURATION);
  });
});

describe("calendarDaysUntilUTC", () => {
  test("same UTC date is 0 days regardless of time of day", () => {
    expect(
      calendarDaysUntilUTC(
        new Date("2026-06-11T01:00:00Z"),
        new Date("2026-06-11T23:30:00Z"),
      ),
    ).toBe(0);
  });

  test("crossing a single UTC midnight is 1 day (session tomorrow)", () => {
    expect(
      calendarDaysUntilUTC(
        new Date("2026-06-11T23:00:00Z"),
        new Date("2026-06-12T01:00:00Z"),
      ),
    ).toBe(1);
  });

  test("floors partial days to whole UTC date boundaries", () => {
    expect(
      calendarDaysUntilUTC(
        new Date("2026-06-11T00:00:00Z"),
        new Date("2026-06-16T23:59:59Z"),
      ),
    ).toBe(5);
  });

  test("clamps past sessions to 0", () => {
    expect(
      calendarDaysUntilUTC(
        new Date("2026-06-16T00:00:00Z"),
        new Date("2026-06-11T00:00:00Z"),
      ),
    ).toBe(0);
  });
});

describe("projectedCalendarDurationSeconds", () => {
  const syncAt = new Date("2026-06-11T12:00:00Z");
  // 8am UTC, n whole calendar days after syncAt's UTC date.
  const daysOut = (n: number) => new Date(Date.UTC(2026, 5, 11 + n, 8, 0, 0));

  test("two participants: projects the minimum participant +10s/day (issue example)", () => {
    // host day 10 (150s) + guest day 1 (60s) → min 60s; 5 days out → 60 + 5*10 = 110
    expect(projectedCalendarDurationSeconds([10, 1], syncAt, daysOut(5))).toBe(110);
  });

  test("N participants: picks the global minimum, then projects", () => {
    // days [4,2,6] → lengths [90,70,110] → min 70; 3 days out → 70 + 3*10 = 100
    expect(projectedCalendarDurationSeconds([4, 2, 6], syncAt, daysOut(3))).toBe(100);
  });

  test("0 days out equals the live normalized minimum (no projection)", () => {
    const sameDay = new Date("2026-06-11T23:00:00Z");
    expect(projectedCalendarDurationSeconds([10, 1], syncAt, sameDay)).toBe(
      normalizedBuddySessionDurationSeconds([10, 1]),
    );
    expect(projectedCalendarDurationSeconds([3, 3], syncAt, sameDay)).toBe(80);
  });

  test("many days out scales linearly at +10s/day", () => {
    // days [10,11,12,13] → min 150; 30 days out → 150 + 30*10 = 450
    expect(projectedCalendarDurationSeconds([10, 11, 12, 13], syncAt, daysOut(30))).toBe(450);
  });

  test("respects the 60s floor", () => {
    expect(projectedCalendarDurationSeconds([1, 1], syncAt, daysOut(0))).toBe(BASE_DURATION);
    expect(projectedCalendarDurationSeconds([], syncAt, daysOut(0))).toBe(BASE_DURATION);
  });
});
