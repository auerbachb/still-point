import { describe, expect, test } from "vitest";
import {
  aggregateMonthSummary,
  buildPriorMonthSummaries,
  buildTrailing12MonthSummaries,
  formatShortMonthLabel,
} from "./historyMonthlyAggregation";

const SAMPLE_SESSIONS = [
  { sessionDate: "2026-05-10", duration: 600, actualTime: 600 },
  { sessionDate: "2026-05-20", duration: 300, actualTime: 300 },
  { sessionDate: "2026-06-15", duration: 120, actualTime: 120 },
  { sessionDate: "2026-07-01", duration: 60, actualTime: 60 },
];

describe("aggregateMonthSummary", () => {
  test("counts unique active days and total sit seconds", () => {
    const summary = aggregateMonthSummary(SAMPLE_SESSIONS, 2026, 5);
    expect(summary).toMatchObject({
      yearMonth: "2026-05",
      daysActive: 2,
      daysInMonth: 31,
      totalTimeSeconds: 900,
    });
  });
});

describe("buildTrailing12MonthSummaries", () => {
  test("returns exactly 12 months ending with the month of today", () => {
    const summaries = buildTrailing12MonthSummaries(SAMPLE_SESSIONS, "2026-07-02");
    expect(summaries).toHaveLength(12);
    expect(summaries[0].yearMonth).toBe("2025-08");
    expect(summaries[11].yearMonth).toBe("2026-07");
  });

  test("includes days active and total time per month", () => {
    const summaries = buildTrailing12MonthSummaries(SAMPLE_SESSIONS, "2026-07-02");
    const may = summaries.find(s => s.yearMonth === "2026-05")!;
    const jul = summaries.find(s => s.yearMonth === "2026-07")!;

    expect(may).toMatchObject({ daysActive: 2, totalTimeSeconds: 900 });
    expect(jul).toMatchObject({ daysActive: 1, totalTimeSeconds: 60 });
  });

  test("months without sessions show zero activity", () => {
    const summaries = buildTrailing12MonthSummaries(SAMPLE_SESSIONS, "2026-07-02");
    const aug2025 = summaries.find(s => s.yearMonth === "2025-08")!;
    expect(aug2025).toMatchObject({ daysActive: 0, totalTimeSeconds: 0, daysInMonth: 31 });
  });
});

describe("buildPriorMonthSummaries", () => {
  test("aggregates days active and total time for months before current", () => {
    const summaries = buildPriorMonthSummaries(SAMPLE_SESSIONS, "2026-07-02");

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

describe("formatShortMonthLabel", () => {
  test("formats year-month as short label", () => {
    expect(formatShortMonthLabel("2026-07")).toBe("Jul 2026");
  });
});
