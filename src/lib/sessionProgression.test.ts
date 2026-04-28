import { describe, expect, test } from "vitest";
import {
  calculateSessionStats,
  isSessionType,
  shouldAdvanceDay,
  type SessionStatsInput,
} from "./constants";

describe("session progression rules", () => {
  test("only advances the day counter for completed standard sessions", () => {
    expect(shouldAdvanceDay("standard", true)).toBe(true);
    expect(shouldAdvanceDay("standard", false)).toBe(false);
    expect(shouldAdvanceDay("quick", true)).toBe(false);
    expect(shouldAdvanceDay("quick", false)).toBe(false);
  });

  test("recognizes supported session types", () => {
    expect(isSessionType("standard")).toBe(true);
    expect(isSessionType("quick")).toBe(true);
    expect(isSessionType("other")).toBe(false);
  });

  test("excludes quick sessions from progression stats", () => {
    const sessions: SessionStatsInput[] = [
      { sessionType: "standard", dayNumber: 1, duration: 60, completed: true, clearPercent: 80, thoughtCount: 2 },
      { sessionType: "quick", dayNumber: 2, duration: 60, completed: true, clearPercent: 10, thoughtCount: 20 },
      { sessionType: "standard", dayNumber: 2, duration: 70, completed: true, clearPercent: 100, thoughtCount: 0 },
    ];

    expect(calculateSessionStats(sessions)).toEqual({
      streak: 2,
      avgClearPercent: 90,
      avgThoughtsPerSession: 1,
      avgThoughtsPerMinute: 1,
    });
  });
});
