import { describe, expect, test } from "vitest";
import {
  computeMindStateCompositionFromLog,
  recordHoldSegment,
} from "./mindStateSession";
import { calculateMindStateTrendStats } from "./historyMindStateTrends";

describe("computeMindStateCompositionFromLog", () => {
  test("empty log is fully clear", () => {
    expect(computeMindStateCompositionFromLog([], 300)).toEqual({
      clearSeconds: 300,
      lightDistractionSeconds: 0,
      heavyDistractionSeconds: 0,
      hyperfocusSeconds: 0,
      totalSeconds: 300,
    });
  });

  test("splits thinking, hyperfocus, and heavy segments", () => {
    const composition = computeMindStateCompositionFromLog(
      [
        { time: 0, state: "clear" },
        { time: 60, state: "thinking" },
        { time: 120, state: "clear" },
        { time: 180, state: "hyperfocus" },
        { time: 240, state: "heavy" },
        { time: 300, state: "clear" },
      ],
      300,
    );

    expect(composition).toEqual({
      clearSeconds: 120,
      lightDistractionSeconds: 60,
      heavyDistractionSeconds: 60,
      hyperfocusSeconds: 60,
      totalSeconds: 300,
    });
  });

  test("treats time before the first entry as clear", () => {
    const composition = computeMindStateCompositionFromLog(
      [{ time: 50, state: "thinking" }],
      100,
    );
    expect(composition.clearSeconds).toBe(50);
    expect(composition.lightDistractionSeconds).toBe(50);
  });

  test("hold segments replay the same way as clear-percent math", () => {
    let log: Array<{ time: number; state: string }> = [];
    log = recordHoldSegment(log, "hyperfocus", 0, 60);
    log = recordHoldSegment(log, "thinking", 120, 180);
    expect(computeMindStateCompositionFromLog(log, 240)).toEqual({
      clearSeconds: 120,
      lightDistractionSeconds: 60,
      heavyDistractionSeconds: 0,
      hyperfocusSeconds: 60,
      totalSeconds: 240,
    });
  });

  test("skips malformed log entries without throwing", () => {
    const composition = computeMindStateCompositionFromLog(
      [null as unknown as { time: number; state: string }, { time: 30, state: "thinking" }],
      60,
    );
    expect(composition.lightDistractionSeconds).toBe(30);
    expect(composition.clearSeconds).toBe(30);
  });
});

describe("calculateMindStateTrendStats", () => {
  const today = "2026-07-02";

  test("aggregates trailing window and daily buckets by sit seconds", () => {
    const stats = calculateMindStateTrendStats(
      [
        {
          sessionDate: "2026-07-01",
          duration: 120,
          actualTime: 120,
          mindStateLog: [{ time: 0, state: "thinking" }],
        },
        {
          sessionDate: "2026-07-02",
          duration: 60,
          actualTime: 60,
          mindStateLog: [{ time: 0, state: "hyperfocus" }],
        },
        {
          sessionDate: "2026-05-01",
          duration: 300,
          actualTime: 300,
          mindStateLog: [{ time: 0, state: "clear" }],
        },
      ],
      today,
    );

    expect(stats.trailing4Week.totalSitSeconds).toBe(180);
    expect(stats.trailing4Week.lightDistractionPercent).toBeCloseTo(66.7, 1);
    expect(stats.trailing4Week.hyperfocusPercent).toBeCloseTo(33.3, 1);
    expect(stats.trailing4Week.heavyDistractionPercent).toBe(0);
    expect(stats.allTime.totalSitSeconds).toBe(480);
    expect(stats.allTime.clearPercent).toBeCloseTo(62.5, 1);

    const july1 = stats.dailyTrend.find(bucket => bucket.date === "2026-07-01");
    const july2 = stats.dailyTrend.find(bucket => bucket.date === "2026-07-02");
    expect(july1?.composition.lightDistractionPercent).toBe(100);
    expect(july2?.composition.hyperfocusPercent).toBe(100);
    expect(stats.dailyTrend).toHaveLength(28);
  });

  test("returns zeroed stats when there are no sessions", () => {
    const stats = calculateMindStateTrendStats([], today);
    expect(stats.trailing4Week).toMatchObject({
      totalSitSeconds: 0,
      clearPercent: 0,
      lightDistractionPercent: 0,
      heavyDistractionPercent: 0,
      hyperfocusPercent: 0,
    });
    expect(stats.dailyTrend.every(bucket => bucket.totalSitSeconds === 0)).toBe(true);
  });

  test("uses session elapsed timeline instead of wall-clock actualTime when paused", () => {
    const stats = calculateMindStateTrendStats(
      [
        {
          sessionDate: "2026-07-02",
          duration: 300,
          actualTime: 900,
          mindStateLog: [],
        },
      ],
      today,
    );

    expect(stats.trailing4Week.totalSitSeconds).toBe(300);
    expect(stats.trailing4Week.clearPercent).toBe(100);
  });
});
