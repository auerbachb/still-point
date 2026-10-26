import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isoWeekPartsFromDateKey,
  MISSED_SIT_CALL_NOTIFICATION_TYPE,
} from "@/lib/notification-scheduler";
import { addDaysToIsoDate } from "@/lib/sessionCalendar";
import {
  ALL_NUDGES,
  CALL_NUDGE,
  computeNudgeEffectiveness,
  formatNudgeEffectivenessMarkdown,
  localPracticeDateForWindowKey,
  mondayOfIsoWeek,
  resolveReportWindow,
  wilsonInterval,
  type NudgeEffectivenessInput,
  type NudgeEffectivenessReport,
} from "./effectiveness";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const at = (iso: string) => new Date(iso);

function rowFor(report: NudgeEffectivenessReport, nudge: string) {
  const row = report.rows.find((candidate) => candidate.nudge === nudge);
  if (!row) throw new Error(`no row for ${nudge}`);
  return row;
}

describe("localPracticeDateForWindowKey", () => {
  test("a date key is the day itself", () => {
    expect(localPracticeDateForWindowKey("daily_reminder", "2026-10-05")).toBe("2026-10-05");
    expect(localPracticeDateForWindowKey("miss_a_day", "2026-10-05")).toBe("2026-10-05");
  });

  test("a call slot key is the day of that slot", () => {
    expect(localPracticeDateForWindowKey(CALL_NUDGE, "2026-10-05T18")).toBe("2026-10-05");
    expect(localPracticeDateForWindowKey(CALL_NUDGE, "2026-10-05T00")).toBe("2026-10-05");
  });

  test("a weekly daily-reminder key is the Monday of that ISO week", () => {
    expect(localPracticeDateForWindowKey("daily_reminder", "2026-W41")).toBe("2026-10-05");
    expect(localPracticeDateForWindowKey("daily_reminder", "2026-W01")).toBe("2025-12-29");
    expect(localPracticeDateForWindowKey("daily_reminder", "2026-W53")).toBe("2026-12-28");
  });

  test("a week key on any other type is not a local date", () => {
    expect(localPracticeDateForWindowKey("miss_a_day", "2026-W41")).toBeNull();
  });

  test("malformed keys are rejected", () => {
    for (const key of ["2026-02-30", "2026-10-05T24", "2026-10-5", "2025-W53", "2026-W00", "bogus", ""]) {
      expect(localPracticeDateForWindowKey("daily_reminder", key)).toBeNull();
    }
  });

  test("mondayOfIsoWeek inverts isoWeekPartsFromDateKey for every Monday 2019-2032", () => {
    for (let monday = "2019-12-30"; monday <= "2032-12-27"; monday = addDaysToIsoDate(monday, 7)) {
      const { isoYear, week } = isoWeekPartsFromDateKey(monday);
      expect(mondayOfIsoWeek(isoYear, Number(week))).toBe(monday);
    }
  });
});

test("the call row label matches the scheduler's missed-sit call type", () => {
  expect(CALL_NUDGE).toBe(MISSED_SIT_CALL_NOTIFICATION_TYPE);
});

describe("resolveReportWindow", () => {
  test("defaults to the 28 days ending two days before today, UTC", () => {
    expect(resolveReportWindow({}, at("2026-10-26T22:00:00Z"))).toEqual({
      start: "2026-09-27",
      end: "2026-10-24",
      days: 28,
    });
  });

  test("uses an explicit window", () => {
    expect(resolveReportWindow({ days: 7, end: "2026-10-07" })).toEqual({
      start: "2026-10-01",
      end: "2026-10-07",
      days: 7,
    });
  });

  test("rejects bad values", () => {
    for (const days of [0, 1.5, 367, Number.NaN]) {
      expect(() => resolveReportWindow({ days })).toThrow(RangeError);
    }
    expect(() => resolveReportWindow({ end: "2026-13-01" })).toThrow(RangeError);
  });
});

describe("wilsonInterval", () => {
  test("matches published values", () => {
    const half = wilsonInterval(5, 10)!;
    expect(half.low).toBeCloseTo(0.2366, 4);
    expect(half.high).toBeCloseTo(0.7634, 4);

    const none = wilsonInterval(0, 10)!;
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.2775, 4);

    const all = wilsonInterval(10, 10)!;
    expect(all.low).toBeCloseTo(0.7225, 4);
    expect(all.high).toBeCloseTo(1, 12);
  });

  test("has no interval without data", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe("computeNudgeEffectiveness", () => {
  // Window 2026-10-01..07. A and C signed up before it, B on 10-02.
  // D got no nudge of any kind and sat every day.
  const input: NudgeEffectivenessInput = {
    window: { start: "2026-10-01", end: "2026-10-07", days: 7 },
    sends: [
      { userId: A, nudge: "daily_reminder", localDate: "2026-09-30", sentAt: at("2026-09-30T09:00:00Z") },
      { userId: A, nudge: "daily_reminder", localDate: "2026-10-01", sentAt: at("2026-10-01T09:00:00Z") },
      { userId: A, nudge: "daily_reminder", localDate: "2026-10-02", sentAt: at("2026-10-02T09:00:00Z") },
      { userId: B, nudge: "failure_reason_reminder", localDate: "2026-10-02", sentAt: at("2026-10-02T20:00:00Z") },
      { userId: B, nudge: "failure_reason_reminder", localDate: "2026-10-03", sentAt: at("2026-10-03T20:00:00Z") },
      { userId: C, nudge: "daily_reminder", localDate: "2026-10-04", sentAt: at("2026-10-04T09:00:00Z") },
      { userId: C, nudge: CALL_NUDGE, localDate: "2026-10-04", sentAt: at("2026-10-04T18:00:00Z") },
      { userId: C, nudge: CALL_NUDGE, localDate: "2026-10-04", sentAt: at("2026-10-04T19:00:00Z") },
      { userId: C, nudge: CALL_NUDGE, localDate: "2026-10-06", sentAt: at("2026-10-06T18:00:00Z") },
    ],
    unplacedCallAttempts: [
      { userId: C, localDate: "2026-10-05", attemptedAt: at("2026-10-05T18:00:00Z") },
      { userId: C, localDate: "2026-10-06", attemptedAt: at("2026-10-06T19:00:00Z") },
    ],
    sits: [
      { userId: A, sessionDate: "2026-10-01", savedAt: at("2026-10-01T10:00:00Z") },
      { userId: A, sessionDate: "2026-10-03", savedAt: at("2026-10-03T08:00:00Z") },
      { userId: A, sessionDate: "2026-10-04", savedAt: at("2026-10-04T08:00:00Z") },
      { userId: A, sessionDate: "2026-10-05", savedAt: at("2026-10-05T08:00:00Z") },
      // Before that evening's reminder: a sit on a nudged day, but not a conversion.
      { userId: B, sessionDate: "2026-10-02", savedAt: at("2026-10-02T08:00:00Z") },
      { userId: B, sessionDate: "2026-10-03", savedAt: at("2026-10-03T21:00:00Z") },
      { userId: B, sessionDate: "2026-10-06", savedAt: at("2026-10-06T08:00:00Z") },
      { userId: C, sessionDate: "2026-10-04", savedAt: at("2026-10-04T19:30:00Z") },
      { userId: C, sessionDate: "2026-10-05", savedAt: at("2026-10-05T20:00:00Z") },
      ...["01", "02", "03", "04", "05", "06", "07"].map((day) => ({
        userId: D,
        sessionDate: `2026-10-${day}`,
        savedAt: at(`2026-10-${day}T07:00:00Z`),
      })),
    ],
    signupDates: new Map([
      [A, "2026-01-01"],
      [B, "2026-10-02"],
      [C, "2026-01-01"],
    ]),
    unmeasuredLedgerRows: { missed_sit_call: 3 },
    unparsedWindowKeys: 0,
  };
  const report = computeNudgeEffectiveness(input, at("2026-10-12T00:00:00Z"));

  test("daily reminder: conversion counts only sits at or after the nudge", () => {
    expect(rowFor(report, "daily_reminder")).toEqual({
      nudge: "daily_reminder",
      source: "notification_dispatches",
      sent: 3,
      users: 2,
      nudgedDays: 3,
      sharedDays: 1,
      conversion: { count: 2, total: 3, rate: 2 / 3, interval: wilsonInterval(2, 3) },
      nudgedDaySits: { count: 2, total: 3, rate: 2 / 3 },
      // A: 10-03..07 with sits on 03-05. C: 10-01, 02, 03, 05, 07 with a sit on 05.
      unnudgedDaySits: { count: 4, total: 10, rate: 0.4 },
    });
  });

  test("failure-reason: a sit earlier the same day is not a conversion", () => {
    const row = rowFor(report, "failure_reason_reminder");
    expect(row.conversion).toMatchObject({ count: 1, total: 2 });
    expect(row.nudgedDaySits).toEqual({ count: 2, total: 2, rate: 1 });
    // B signed up on 10-02, so the baseline skips 10-01: 10-04..07 with a sit on 06.
    expect(row.unnudgedDaySits).toEqual({ count: 1, total: 4, rate: 0.25 });
  });

  test("calls: several calls on one day are one nudged day", () => {
    expect(rowFor(report, CALL_NUDGE)).toMatchObject({
      source: "call_attempts",
      sent: 3,
      users: 1,
      nudgedDays: 2,
      sharedDays: 1,
      conversion: { count: 1, total: 2 },
      unnudgedDaySits: { count: 1, total: 5 },
    });
  });

  test("a type with no sends has a row of zeros", () => {
    expect(rowFor(report, "miss_a_day")).toEqual({
      nudge: "miss_a_day",
      source: "notification_dispatches",
      sent: 0,
      users: 0,
      nudgedDays: 0,
      sharedDays: 0,
      conversion: { count: 0, total: 0, rate: null, interval: null },
      nudgedDaySits: { count: 0, total: 0, rate: null },
      unnudgedDaySits: { count: 0, total: 0, rate: null },
    });
  });

  test("all nudges: one row over every type, never counting user D", () => {
    expect(rowFor(report, ALL_NUDGES)).toMatchObject({
      source: "all",
      sent: 8,
      users: 3,
      nudgedDays: 6,
      sharedDays: 1,
      conversion: { count: 3, total: 6 },
      nudgedDaySits: { count: 4, total: 6 },
      // A 3 of 5, B 1 of 4, C 1 of 5.
      unnudgedDaySits: { count: 5, total: 14 },
    });
  });

  test("users with zero nudges change nothing", () => {
    const withoutD = computeNudgeEffectiveness(
      { ...input, sits: input.sits.filter((sit) => sit.userId !== D) },
      at("2026-10-12T00:00:00Z"),
    );
    expect(withoutD).toEqual(report);
  });

  test("unplaced calls: only days on which no call went out", () => {
    expect(report.unplacedCalls).toEqual({
      attempts: 2,
      days: 1,
      conversion: { count: 1, total: 1, rate: 1, interval: wilsonInterval(1, 1) },
    });
  });

  test("an unknown nudge type still gets its own row", () => {
    const withSms = computeNudgeEffectiveness({
      ...input,
      sends: [...input.sends, { userId: A, nudge: "sms_reminder", localDate: "2026-10-02", sentAt: at("2026-10-02T12:00:00Z") }],
    });
    expect(rowFor(withSms, "sms_reminder")).toMatchObject({ sent: 1, nudgedDays: 1 });
    expect(rowFor(withSms, ALL_NUDGES).sent).toBe(9);
  });

  describe("formatNudgeEffectivenessMarkdown", () => {
    const markdown = formatNudgeEffectivenessMarkdown(report);

    test("states the window, the rows, and the selection-effect caveat", () => {
      expect(markdown).toContain("2026-10-01 to 2026-10-07 (7 local days)");
      expect(markdown).toContain("--days 7 --end 2026-10-07");
      expect(markdown).toContain("| `daily_reminder` | `notification_dispatches` | 3 | 2 | 3 | 2 | 66.7% (");
      expect(markdown).toContain("| `missed_sit_call` | `call_attempts` | 3 | 1 | 2 | 1 | 50.0% (");
      expect(markdown).toContain("| `miss_a_day` | — | — |");
      expect(markdown).toContain("| All nudges | 66.7% (4 of 6) | 35.7% (5 of 14) |");
      expect(markdown).toContain("**Selection effect:**");
      expect(markdown).toContain("Only a holdout");
      expect(markdown).toContain("`missed_sit_call` ×3");
      expect(markdown).toContain("2 attempts had a status other than `initiated`");
      expect(markdown).toContain(
        "On 1 user-day with an attempt but no placed call, a sit followed the first attempt on 1: 100.0% (",
      );
    });

    test("contains no user ids", () => {
      expect(markdown).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    });

    test("warns when the window has days that may still be open", () => {
      const early = { ...report, generatedAt: "2026-10-08T12:00:00.000Z" };
      expect(formatNudgeEffectivenessMarkdown(early)).toContain("the window ends after 2026-10-06");
      expect(markdown).not.toContain("**Warning:**");
    });

    test("warns about skipped rows", () => {
      expect(formatNudgeEffectivenessMarkdown({ ...report, unparsedWindowKeys: 2 })).toContain(
        "2 rows near the window had a `window_key` that is not a local date",
      );
    });
  });
});
