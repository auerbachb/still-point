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
      bonusSecondsTotal: 0,
    });
  });

  test("excludes invalid session types from progression stats", () => {
    const sessions: SessionStatsInput[] = [
      { sessionType: "Quick", dayNumber: 2, duration: 60, completed: true, clearPercent: 10, thoughtCount: 20 },
      { sessionType: "standard", dayNumber: 1, duration: 60, completed: true, clearPercent: 80, thoughtCount: 2 },
    ];

    expect(calculateSessionStats(sessions)).toEqual({
      streak: 1,
      avgClearPercent: 80,
      avgThoughtsPerSession: 2,
      avgThoughtsPerMinute: 2,
      bonusSecondsTotal: 0,
    });
  });

  test("counts a day in the streak when any same-day standard attempt completed", () => {
    const sessions: SessionStatsInput[] = [
      {
        sessionType: "standard",
        dayNumber: 2,
        duration: 70,
        completed: false,
        clearPercent: 10,
        thoughtCount: 0,
        createdAt: new Date("2026-04-28T10:00:00Z"),
      },
      {
        sessionType: "standard",
        dayNumber: 2,
        duration: 70,
        completed: true,
        clearPercent: 100,
        thoughtCount: 0,
        createdAt: new Date("2026-04-28T10:05:00Z"),
      },
      {
        sessionType: "standard",
        dayNumber: 1,
        duration: 60,
        completed: true,
        clearPercent: 80,
        thoughtCount: 2,
        createdAt: new Date("2026-04-27T10:00:00Z"),
      },
    ];

    expect(calculateSessionStats(sessions).streak).toBe(2);
  });

  test("stops the streak at the first day without a completed standard attempt", () => {
    const sessions: SessionStatsInput[] = [
      { sessionType: "standard", dayNumber: 3, duration: 80, completed: false, clearPercent: 20, thoughtCount: 0 },
      { sessionType: "standard", dayNumber: 2, duration: 70, completed: true, clearPercent: 100, thoughtCount: 0 },
      { sessionType: "standard", dayNumber: 1, duration: 60, completed: true, clearPercent: 80, thoughtCount: 2 },
    ];

    expect(calculateSessionStats(sessions).streak).toBe(0);
  });

  test("falls back to day-number streak when sessionDate is not a strict calendar day", () => {
    const sessions: SessionStatsInput[] = [
      {
        sessionType: "standard",
        dayNumber: 2,
        duration: 70,
        completed: true,
        clearPercent: 100,
        thoughtCount: 0,
        sessionDate: "2026-04-30T12:00:00.000Z",
      },
      {
        sessionType: "standard",
        dayNumber: 1,
        duration: 60,
        completed: true,
        clearPercent: 80,
        thoughtCount: 0,
        sessionDate: "2026-04-30T18:00:00.000Z",
      },
    ];
    expect(calculateSessionStats(sessions).streak).toBe(2);
  });

  test("streak uses unique calendar days when sessionDate is present (multiple sits same day)", () => {
    const sessions: SessionStatsInput[] = [
      {
        sessionType: "standard",
        dayNumber: 2,
        duration: 70,
        completed: true,
        clearPercent: 100,
        thoughtCount: 0,
        sessionDate: "2026-04-30",
      },
      {
        sessionType: "standard",
        dayNumber: 1,
        duration: 60,
        completed: true,
        clearPercent: 80,
        thoughtCount: 0,
        sessionDate: "2026-04-30",
      },
    ];
    expect(calculateSessionStats(sessions).streak).toBe(1);
  });

  test("calendar-day streak walks consecutive dates including gaps in day numbers", () => {
    const sessions: SessionStatsInput[] = [
      {
        sessionType: "standard",
        dayNumber: 5,
        duration: 100,
        completed: true,
        clearPercent: 80,
        thoughtCount: 0,
        sessionDate: "2026-04-29",
      },
      {
        sessionType: "standard",
        dayNumber: 3,
        duration: 60,
        completed: true,
        clearPercent: 90,
        thoughtCount: 0,
        sessionDate: "2026-04-28",
      },
    ];
    expect(calculateSessionStats(sessions).streak).toBe(2);
  });

  test("calendar streak breaks on missed calendar day", () => {
    const sessions: SessionStatsInput[] = [
      {
        sessionType: "standard",
        dayNumber: 3,
        duration: 80,
        completed: true,
        clearPercent: 90,
        thoughtCount: 0,
        sessionDate: "2026-04-30",
      },
      {
        sessionType: "standard",
        dayNumber: 2,
        duration: 70,
        completed: true,
        clearPercent: 100,
        thoughtCount: 0,
        sessionDate: "2026-04-28",
      },
    ];
    expect(calculateSessionStats(sessions).streak).toBe(1);
  });

  test("stops the streak at missing day gaps", () => {
    const sessions: SessionStatsInput[] = [
      { sessionType: "standard", dayNumber: 7, duration: 120, completed: true, clearPercent: 90, thoughtCount: 0 },
      { sessionType: "standard", dayNumber: 5, duration: 100, completed: true, clearPercent: 80, thoughtCount: 1 },
    ];

    expect(calculateSessionStats(sessions).streak).toBe(1);
  });

  test("bonus time does not affect streak; counts toward bonusSecondsTotal and thoughts/min denominator", () => {
    const sessions: SessionStatsInput[] = [
      { sessionType: "standard", dayNumber: 1, duration: 300, bonusSeconds: 120, completed: true, clearPercent: 80, thoughtCount: 6 },
    ];
    const stats = calculateSessionStats(sessions);
    expect(stats.streak).toBe(1);
    expect(stats.bonusSecondsTotal).toBe(120);
    expect(stats.avgThoughtsPerMinute).toBe(0.9);
  });
});
