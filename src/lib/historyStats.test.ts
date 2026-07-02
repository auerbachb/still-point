import { describe, expect, test } from "vitest";
import { calculateHistoryPeriodStats, sessionTimeSeconds } from "./historyStats";

describe("sessionTimeSeconds", () => {
  test("uses actualTime and includes bonus seconds", () => {
    expect(sessionTimeSeconds({ duration: 60, actualTime: 90, bonusSeconds: 30 })).toBe(120);
  });

  test("falls back to duration when actualTime is null", () => {
    expect(sessionTimeSeconds({ duration: 300, actualTime: null })).toBe(300);
  });
});

describe("calculateHistoryPeriodStats", () => {
  const today = "2026-07-02";

  test("counts unique session dates and sums time in trailing 28 days", () => {
    const stats = calculateHistoryPeriodStats(
      [
        { sessionDate: "2026-05-01", duration: 60, actualTime: 60 },
        { sessionDate: "2026-07-01", duration: 120, actualTime: 120 },
        { sessionDate: "2026-07-02", duration: 60, actualTime: 60 },
        { sessionDate: "2026-07-02", duration: 60, actualTime: 30 },
      ],
      today,
    );

    expect(stats.trailing4WeekDays).toBe(2);
    expect(stats.trailing4WeekTotalTime).toBe(210);
    expect(stats.trailing4WeekDayPercent).toBeCloseTo(7.1, 1);
    expect(stats.trailing4WeekTimePercent).toBeCloseTo(0.01, 2);
  });

  test("computes all-time total and 10k-hour progress", () => {
    const stats = calculateHistoryPeriodStats(
      [
        { sessionDate: "2026-01-01", duration: 3600, actualTime: 3600 },
        { sessionDate: "2026-07-02", duration: 600, actualTime: 600 },
      ],
      today,
    );

    expect(stats.totalTimeAllTime).toBe(4200);
    expect(stats.progressTo10kHours).toBeCloseTo(0.01, 2);
  });

  test("returns zeros when there are no sessions", () => {
    expect(calculateHistoryPeriodStats([], today)).toEqual({
      trailing4WeekDays: 0,
      trailing4WeekDayPercent: 0,
      trailing4WeekTotalTime: 0,
      trailing4WeekTimePercent: 0,
      totalTimeAllTime: 0,
      progressTo10kHours: 0,
    });
  });

  test("excludes sessions outside the trailing window from period counts but includes in all-time", () => {
    const stats = calculateHistoryPeriodStats(
      [{ sessionDate: "2026-05-01", duration: 100, actualTime: 100 }],
      today,
    );
    expect(stats.trailing4WeekDays).toBe(0);
    expect(stats.totalTimeAllTime).toBe(100);
  });
});
