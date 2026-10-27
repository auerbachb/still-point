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

/** #769: today's two sits done as one, stored on the primary track. */
function combinedSit(sessionDate: string, overrides: Partial<PracticeDaySit> = {}): PracticeDaySit {
  return { ...standardSit(sessionDate, "primary"), combined: true, ...overrides };
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

  test("keeps a combined row's flag, so the row counts for both tracks (#892)", () => {
    const row = {
      id: "s-2",
      completed: true,
      sessionType: "standard" as const,
      sessionDate: "2026-10-25",
      track: "primary" as const,
      combined: true,
      duration: 850,
    };
    expect(practiceDaySit(row)).toEqual(combinedSit("2026-10-25"));
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

  test("a remembered combined sit and the server's combined row are one sit (#892)", () => {
    const server = [combinedSit("2026-10-25")];
    expect(mergeRememberedSits(server, [combinedSit("2026-10-25")])).toEqual(server);
  });

  test("keeps a remembered combined sit beside a plain primary sit that day (#892)", () => {
    // Both are primary rows, but only the combined one checks off Track Two.
    const server = [standardSit("2026-10-25", "primary")];
    const combined = combinedSit("2026-10-25");
    const merged = mergeRememberedSits(server, [combined]);
    expect(merged).toEqual([...server, combined]);
    expect(tracksDoneOn(merged, "2026-10-25")).toEqual({ primary: true, second: true });
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

  test("one combined sit closes a two-a-day yesterday on its own (#892)", () => {
    expect(creditedPracticeDate([combinedSit("2026-10-25")], true, beforeCutoff)).toBe("2026-10-26");
    // Ended early, it closes nothing.
    expect(creditedPracticeDate([combinedSit("2026-10-25", { completed: false })], true, beforeCutoff))
      .toBe("2026-10-25");
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

  test("remembers a combined sit as one sit done for both tracks (#892)", () => {
    const sits = rememberStandardSit(null, "2026-10-25", "primary", true);
    expect(sits).toEqual([combinedSit("2026-10-25")]);
    expect(tracksDoneOn(sits, "2026-10-25")).toEqual({ primary: true, second: true });
  });

  test("a combined sit already counted is not remembered twice (#892)", () => {
    const sits = [combinedSit("2026-10-25")];
    expect(rememberStandardSit(sits, "2026-10-25", "primary", true)).toBe(sits);
  });

  test("an ordinary remembered sit has no combined key (#892)", () => {
    const [sit] = rememberStandardSit(null, "2026-10-25", "second");
    expect(sit).not.toHaveProperty("combined");
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

  test("a combined row counts for both tracks (#892)", () => {
    expect(tracksDoneOn([combinedSit("2026-10-26")], "2026-10-26")).toEqual({ primary: true, second: true });
  });

  test("an ended-early, quick or other-day combined row counts for neither (#892)", () => {
    const sits = [
      combinedSit("2026-10-26", { completed: false }),
      combinedSit("2026-10-26", { sessionType: "quick" }),
      combinedSit("2026-10-25"),
    ];
    expect(tracksDoneOn(sits, "2026-10-26")).toEqual({ primary: false, second: false });
  });
});
