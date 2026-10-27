import { afterEach, describe, expect, test, vi } from "vitest";
import {
  creditedLocalIsoDate,
  effectiveTodayLocalIsoDate,
  getLocalIsoDate,
  isDayCompleteForEnabledTracks,
  todayLocalIsoDate,
  isValidSessionCalendarDate,
  tracksCredited,
  type PracticeDaySit,
} from "./sessionCalendar";

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

describe("getLocalIsoDate", () => {
  afterEach(() => vi.useRealTimers());

  test("defaults to today's local calendar day (matches todayLocalIsoDate)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 10, 30, 0)); // local Jan 5, 2026
    expect(getLocalIsoDate()).toBe("2026-01-05");
    expect(getLocalIsoDate()).toBe(todayLocalIsoDate());
  });

  test("applies a negative offset across a month boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 3, 12, 0, 0)); // local Mar 3, 2026
    expect(getLocalIsoDate(-5)).toBe("2026-02-26");
  });

  test("applies a positive offset across a year boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 12, 0, 0)); // local Dec 31, 2026
    expect(getLocalIsoDate(1)).toBe("2027-01-01");
  });
});

function sit(sessionDate: string, track: "primary" | "second" | null = "primary"): PracticeDaySit {
  return { completed: true, sessionType: "standard", sessionDate, track };
}

/** #769: today's two sits done as one, stored on the primary track. */
function combinedSit(sessionDate: string, overrides: Partial<PracticeDaySit> = {}): PracticeDaySit {
  return { ...sit(sessionDate, "primary"), combined: true, ...overrides };
}

describe("tracksCredited (#890)", () => {
  test.each<[string, Pick<PracticeDaySit, "track" | "combined">, { primary: boolean; second: boolean }]>([
    ["a primary row", { track: "primary" }, { primary: true, second: false }],
    ["a second-track row", { track: "second" }, { primary: false, second: true }],
    ["a row with no track", {}, { primary: true, second: false }],
    ["a row with a null track", { track: null }, { primary: true, second: false }],
    ["a combined primary row", { track: "primary", combined: true }, { primary: true, second: true }],
    ["a combined row with no track", { combined: true }, { primary: true, second: true }],
    ["a combined second-track row", { track: "second", combined: true }, { primary: true, second: true }],
    ["a row with combined false", { track: "primary", combined: false }, { primary: true, second: false }],
    ["a second-track row with combined false", { track: "second", combined: false }, { primary: false, second: true }],
    ["a row with combined null", { track: "second", combined: null }, { primary: false, second: true }],
  ])("%s", (_label, row, expected) => {
    expect(tracksCredited(row)).toEqual(expected);
  });
});

describe("effectiveTodayLocalIsoDate", () => {
  // Local wall clock. 6:00:00 is the new day; the grace window is [00:00, 06:00).
  const today = new Date(2026, 9, 7, 12, 0, 0); // Oct 7
  const elevenFiftyNine = new Date(2026, 9, 7, 23, 59, 0);
  const twelveThirty = new Date(2026, 9, 8, 0, 30, 0);
  const fiveFiftyNine = new Date(2026, 9, 8, 5, 59, 0);
  const sixAm = new Date(2026, 9, 8, 6, 0, 0);

  test("11:59pm on an unfinished day credits that calendar day", () => {
    expect(effectiveTodayLocalIsoDate(false, elevenFiftyNine)).toBe("2026-10-07");
  });

  test("12:30am on an unfinished day credits yesterday", () => {
    expect(effectiveTodayLocalIsoDate(false, twelveThirty)).toBe("2026-10-07");
  });

  test("12:30am on a finished day credits the new calendar day", () => {
    expect(effectiveTodayLocalIsoDate(true, twelveThirty)).toBe("2026-10-08");
  });

  test("5:59am on an unfinished day still credits yesterday", () => {
    expect(effectiveTodayLocalIsoDate(false, fiveFiftyNine)).toBe("2026-10-07");
  });

  test("6:00am credits the new day even when yesterday is unfinished", () => {
    expect(effectiveTodayLocalIsoDate(false, sixAm)).toBe("2026-10-08");
    expect(effectiveTodayLocalIsoDate(true, sixAm)).toBe("2026-10-08");
  });

  test("afternoon credits the calendar day whether or not yesterday is finished", () => {
    expect(effectiveTodayLocalIsoDate(false, today)).toBe("2026-10-07");
    expect(effectiveTodayLocalIsoDate(true, today)).toBe("2026-10-07");
  });
});

describe("isDayCompleteForEnabledTracks", () => {
  test("single-track is complete once the primary standard sit is done", () => {
    expect(isDayCompleteForEnabledTracks([sit("2026-10-07")], "2026-10-07", false)).toBe(true);
    expect(isDayCompleteForEnabledTracks([], "2026-10-07", false)).toBe(false);
  });

  test("a missing track counts as primary", () => {
    expect(isDayCompleteForEnabledTracks([sit("2026-10-07", null)], "2026-10-07", false)).toBe(true);
  });

  test("quick and incomplete sits do not finish the day", () => {
    const sits: PracticeDaySit[] = [
      { completed: true, sessionType: "quick", sessionDate: "2026-10-07", track: "primary" },
      { completed: false, sessionType: "standard", sessionDate: "2026-10-07", track: "primary" },
    ];
    expect(isDayCompleteForEnabledTracks(sits, "2026-10-07", false)).toBe(false);
  });

  test("two-a-day stays open until both standard sits are done", () => {
    expect(isDayCompleteForEnabledTracks([sit("2026-10-07", "primary")], "2026-10-07", true)).toBe(false);
    expect(isDayCompleteForEnabledTracks([sit("2026-10-07", "second")], "2026-10-07", true)).toBe(false);
    expect(isDayCompleteForEnabledTracks(
      [sit("2026-10-07", "primary"), sit("2026-10-07", "second")],
      "2026-10-07",
      true,
    )).toBe(true);
  });

  test("a sit on another day does not complete this one", () => {
    expect(isDayCompleteForEnabledTracks([sit("2026-10-06")], "2026-10-07", false)).toBe(false);
  });

  test("one completed combined sit closes a two-a-day day (#890)", () => {
    expect(isDayCompleteForEnabledTracks([combinedSit("2026-10-07")], "2026-10-07", true)).toBe(true);
  });

  test("a combined sit closes a single-track day, as any primary sit does (#890)", () => {
    expect(isDayCompleteForEnabledTracks([combinedSit("2026-10-07")], "2026-10-07", false)).toBe(true);
  });

  test("an ended-early, quick or other-day combined sit does not close a two-a-day day (#890)", () => {
    const sits: PracticeDaySit[] = [
      combinedSit("2026-10-07", { completed: false }),
      combinedSit("2026-10-07", { sessionType: "quick" }),
      combinedSit("2026-10-06"),
    ];
    expect(isDayCompleteForEnabledTracks(sits, "2026-10-07", true)).toBe(false);
  });
});

describe("creditedLocalIsoDate", () => {
  const twelveThirty = new Date(2026, 9, 8, 0, 30, 0);

  test("12:30am unfinished single-track day credits yesterday", () => {
    expect(creditedLocalIsoDate([], false, twelveThirty)).toBe("2026-10-07");
  });

  test("12:30am finished single-track day credits the new day", () => {
    expect(creditedLocalIsoDate([sit("2026-10-07")], false, twelveThirty)).toBe("2026-10-08");
  });

  test("12:30am two-a-day with only the primary sit credits yesterday", () => {
    expect(creditedLocalIsoDate([sit("2026-10-07", "primary")], true, twelveThirty)).toBe("2026-10-07");
  });

  test("12:30am two-a-day with both sits credits the new day", () => {
    expect(creditedLocalIsoDate(
      [sit("2026-10-07", "primary"), sit("2026-10-07", "second")],
      true,
      twelveThirty,
    )).toBe("2026-10-08");
  });

  test("6:00am credits the new day even when yesterday is unfinished", () => {
    const sixAm = new Date(2026, 9, 8, 6, 0, 0);
    expect(creditedLocalIsoDate([], false, sixAm)).toBe("2026-10-08");
  });

  test("5:30am two-a-day whose yesterday was closed by a combined sit credits the new day (#890)", () => {
    const fiveThirty = new Date(2026, 9, 8, 5, 30, 0);
    expect(creditedLocalIsoDate([combinedSit("2026-10-07")], true, fiveThirty)).toBe("2026-10-08");
    // Control: the same primary sit, not combined, leaves yesterday open.
    expect(creditedLocalIsoDate([sit("2026-10-07", "primary")], true, fiveThirty)).toBe("2026-10-07");
  });

  test("5:30am two-a-day with an ended-early combined sit yesterday still credits yesterday (#890)", () => {
    const fiveThirty = new Date(2026, 9, 8, 5, 30, 0);
    expect(creditedLocalIsoDate([combinedSit("2026-10-07", { completed: false })], true, fiveThirty))
      .toBe("2026-10-07");
  });
});
