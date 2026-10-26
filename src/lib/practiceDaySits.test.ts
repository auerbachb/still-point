import { describe, expect, test } from "vitest";
import type { PracticeDaySit } from "./sessionCalendar";
import {
  creditedPracticeDate,
  mergeRememberedSits,
  practiceDaySit,
  rememberStandardSit,
  tracksDoneOn,
} from "./practiceDaySits";

function standardSit(sessionDate: string, track?: "primary" | "second"): PracticeDaySit {
  return { completed: true, sessionType: "standard", sessionDate, track };
}

describe("practiceDaySit", () => {
  test("keeps only the fields the practice-day rule reads", () => {
    const row = {
      id: "s-1",
      completed: true,
      sessionType: "standard" as const,
      sessionDate: "2026-10-25",
      track: "second" as const,
      duration: 600,
    };
    expect(practiceDaySit(row)).toEqual({
      completed: true,
      sessionType: "standard",
      sessionDate: "2026-10-25",
      track: "second",
    });
  });
});

describe("mergeRememberedSits", () => {
  test("adds a queued standard sit the server list does not have yet", () => {
    const server = [standardSit("2026-10-24")];
    const queued = standardSit("2026-10-25");
    expect(mergeRememberedSits(server, [queued])).toEqual([...server, queued]);
  });

  test("skips a remembered sit the server already returned, counting a missing track as primary", () => {
    const server = [standardSit("2026-10-25")];
    expect(mergeRememberedSits(server, [standardSit("2026-10-25", "primary")])).toEqual(server);
  });

  test("treats the second track as a different sit on the same day", () => {
    const server = [standardSit("2026-10-25", "primary")];
    const second = standardSit("2026-10-25", "second");
    expect(mergeRememberedSits(server, [second])).toEqual([...server, second]);
  });

  test("never adds an abandoned or non-standard remembered sit", () => {
    const abandoned: PracticeDaySit = { completed: false, sessionType: "standard", sessionDate: "2026-10-25" };
    const quick: PracticeDaySit = { completed: true, sessionType: "quick", sessionDate: "2026-10-25" };
    expect(mergeRememberedSits([], [abandoned, quick])).toEqual([]);
  });

  test("does not mutate the server list", () => {
    const server = [standardSit("2026-10-24")];
    mergeRememberedSits(server, [standardSit("2026-10-25")]);
    expect(server).toEqual([standardSit("2026-10-24")]);
  });
});

describe("creditedPracticeDate", () => {
  const beforeCutoff = new Date(2026, 9, 26, 5, 59, 0); // local Oct 26, 5:59
  const atCutoff = new Date(2026, 9, 26, 6, 0, 0); // local Oct 26, 6:00

  test("with no session list yet, keeps yesterday open before 6:00", () => {
    expect(creditedPracticeDate(null, false, beforeCutoff)).toBe("2026-10-25");
    expect(creditedPracticeDate(null, true, beforeCutoff)).toBe("2026-10-25");
  });

  test("with no session list yet, credits the calendar day from 6:00", () => {
    expect(creditedPracticeDate(null, false, atCutoff)).toBe("2026-10-26");
  });

  test("before 6:00, credits yesterday while its required sit is still open", () => {
    expect(creditedPracticeDate([], false, beforeCutoff)).toBe("2026-10-25");
  });

  test("before 6:00, credits today once yesterday's required sits are done", () => {
    const sits = [standardSit("2026-10-25")];
    expect(creditedPracticeDate(sits, false, beforeCutoff)).toBe("2026-10-26");
  });

  test("a two-a-day schedule keeps yesterday open until the second track is done too", () => {
    const primaryOnly = [standardSit("2026-10-25", "primary")];
    expect(creditedPracticeDate(primaryOnly, true, beforeCutoff)).toBe("2026-10-25");
    const both = [...primaryOnly, standardSit("2026-10-25", "second")];
    expect(creditedPracticeDate(both, true, beforeCutoff)).toBe("2026-10-26");
  });
});

describe("rememberStandardSit", () => {
  test("starts a list when none has loaded yet", () => {
    expect(rememberStandardSit(null, "2026-10-25", "primary")).toEqual([
      standardSit("2026-10-25", "primary"),
    ]);
  });

  test("appends a sit the list does not count yet, without mutating it", () => {
    const sits = [standardSit("2026-10-24")];
    const next = rememberStandardSit(sits, "2026-10-25", "second");
    expect(next).toEqual([...sits, standardSit("2026-10-25", "second")]);
    expect(sits).toHaveLength(1);
  });

  test("returns the same list when the sit is already counted", () => {
    const sits = [standardSit("2026-10-25")];
    // A row with no track is a primary sit, so the primary sit is already there.
    expect(rememberStandardSit(sits, "2026-10-25", "primary")).toBe(sits);
  });

  test("an abandoned sit on that day does not count as done", () => {
    const sits: PracticeDaySit[] = [{ completed: false, sessionType: "standard", sessionDate: "2026-10-25" }];
    expect(rememberStandardSit(sits, "2026-10-25", "primary")).toHaveLength(2);
  });
});

describe("tracksDoneOn", () => {
  test("reports each track that has a completed standard sit that day", () => {
    const sits = [standardSit("2026-10-26", "primary"), standardSit("2026-10-26", "second")];
    expect(tracksDoneOn(sits, "2026-10-26")).toEqual({ primary: true, second: true });
    expect(tracksDoneOn([standardSit("2026-10-26", "second")], "2026-10-26")).toEqual({
      primary: false,
      second: true,
    });
  });

  test("counts a row with no track as the primary track", () => {
    expect(tracksDoneOn([standardSit("2026-10-26")], "2026-10-26")).toEqual({
      primary: true,
      second: false,
    });
  });

  test("ignores other days, abandoned sits, and non-standard sits", () => {
    const sits: PracticeDaySit[] = [
      standardSit("2026-10-25", "primary"),
      { completed: false, sessionType: "standard", sessionDate: "2026-10-26", track: "primary" },
      { completed: true, sessionType: "quick", sessionDate: "2026-10-26", track: "second" },
      { completed: true, sessionType: "breath", sessionDate: "2026-10-26" },
    ];
    expect(tracksDoneOn(sits, "2026-10-26")).toEqual({ primary: false, second: false });
  });
});
