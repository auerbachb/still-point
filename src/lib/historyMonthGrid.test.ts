import { describe, expect, test } from "vitest";
import {
  buildCurrentMonthGrid,
  buildPriorMonthSummaries,
  formatSessionDurationLabel,
  formatTotalTime,
} from "./historyMonthGrid";

describe("formatSessionDurationLabel", () => {
  test("shows seconds under one minute", () => {
    expect(formatSessionDurationLabel(45)).toBe("45s");
  });

  test("shows rounded minutes at or above one minute", () => {
    expect(formatSessionDurationLabel(480)).toBe("8m");
  });
});

describe("buildCurrentMonthGrid", () => {
  test("marks days with any session as meditated and missed days as gray state", () => {
    const grid = buildCurrentMonthGrid(
      [
        { sessionDate: "2026-07-01", duration: 480, actualTime: 480 },
        { sessionDate: "2026-07-02", duration: 60, actualTime: 60, sessionType: "quick" } as never,
      ],
      "2026-07-02",
    );

    expect(grid.yearMonth).toBe("2026-07");
    const dayCells = grid.cells.filter(c => c.kind === "day").map(c => c.day!);
    const jul1 = dayCells.find(d => d.isoDate === "2026-07-01")!;
    const jul2 = dayCells.find(d => d.isoDate === "2026-07-02")!;
    const jul3 = dayCells.find(d => d.isoDate === "2026-07-03")!;

    expect(jul1.state).toBe("meditated");
    expect(jul1.durationLabels).toEqual(["8m"]);
    expect(jul2.state).toBe("meditated");
    expect(jul3.state).toBe("future");
  });

  test("shows today without a session as today state", () => {
    const grid = buildCurrentMonthGrid(
      [{ sessionDate: "2026-07-01", duration: 60, actualTime: 60 }],
      "2026-07-02",
    );
    const today = grid.cells
      .filter(c => c.kind === "day")
      .map(c => c.day!)
      .find(d => d.isoDate === "2026-07-02")!;
    expect(today.state).toBe("today");
  });

  test("comma-delimits multiple sessions on one day via durationLabels", () => {
    const grid = buildCurrentMonthGrid(
      [
        { sessionDate: "2026-07-01", duration: 480, actualTime: 480 },
        { sessionDate: "2026-07-01", duration: 60, actualTime: 60 },
      ],
      "2026-07-02",
    );
    const jul1 = grid.cells
      .filter(c => c.kind === "day")
      .map(c => c.day!)
      .find(d => d.isoDate === "2026-07-01")!;
    expect(jul1.durationLabels).toEqual(["8m", "1m"]);
  });
});

describe("buildPriorMonthSummaries", () => {
  test("aggregates days active and total time for months before current", () => {
    const summaries = buildPriorMonthSummaries(
      [
        { sessionDate: "2026-05-10", duration: 600, actualTime: 600 },
        { sessionDate: "2026-05-20", duration: 300, actualTime: 300 },
        { sessionDate: "2026-06-15", duration: 120, actualTime: 120 },
        { sessionDate: "2026-07-01", duration: 60, actualTime: 60 },
      ],
      "2026-07-02",
    );

    expect(summaries.map(s => s.yearMonth)).toEqual(["2026-05", "2026-06"]);
    expect(summaries[0]).toMatchObject({ daysActive: 2, daysInMonth: 31, totalTimeSeconds: 900 });
    expect(summaries[1]).toMatchObject({ daysActive: 1, daysInMonth: 30, totalTimeSeconds: 120 });
  });

  test("returns empty when all sessions are in the current month", () => {
    expect(
      buildPriorMonthSummaries(
        [{ sessionDate: "2026-07-01", duration: 60, actualTime: 60 }],
        "2026-07-02",
      ),
    ).toEqual([]);
  });
});

describe("formatTotalTime", () => {
  test("formats hours and minutes", () => {
    expect(formatTotalTime(8100)).toBe("2h 15m");
    expect(formatTotalTime(3600)).toBe("1h");
    expect(formatTotalTime(90)).toBe("2m");
  });
});
