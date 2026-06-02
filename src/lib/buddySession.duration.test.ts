import { describe, expect, test } from "vitest";
import { BASE_DURATION } from "@/lib/constants";
import { normalizedBuddySessionDurationSeconds } from "@/lib/buddySessionDuration";

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
