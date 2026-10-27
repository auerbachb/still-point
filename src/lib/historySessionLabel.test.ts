import { describe, expect, test } from "vitest";
import type { Session } from "./api";
import { buildHistoryJourneyRows } from "./historyJourney";
import { historySessionLabel } from "./historySessionLabel";

describe("historySessionLabel (#895)", () => {
  test("a combined sit reads Combined in place of its ordinal", () => {
    expect(historySessionLabel({ sessionType: "standard", combined: true, sessionIndexInDay: 1 })).toBe("Combined");
  });

  test("quick and breath rows keep their own labels", () => {
    expect(historySessionLabel({ sessionType: "quick", sessionIndexInDay: 2 })).toBe("Quick");
    expect(historySessionLabel({ sessionType: "breath", sessionIndexInDay: 1 })).toBe("Breath");
  });

  test("a focus row names its category, or reads Focus without one", () => {
    expect(historySessionLabel({ sessionType: "focus", focusCategory: "reading" })).toBe("Focus · Reading");
    expect(historySessionLabel({ sessionType: "focus", focusCategory: null })).toBe("Focus");
  });

  test("an ordinary sit reads Session n, and Session 1 when no ordinal is known", () => {
    expect(historySessionLabel({ sessionType: "standard", combined: false, sessionIndexInDay: 3 })).toBe("Session 3");
    expect(historySessionLabel({ sessionType: "standard", sessionIndexInDay: 2 })).toBe("Session 2");
    expect(historySessionLabel({})).toBe("Session 1");
  });

  test("a later standard sit on the day of a combined sit keeps its own ordinal", () => {
    const sits: Array<Pick<Session, "sessionType" | "combined">> = [
      { sessionType: "standard", combined: true },
      { sessionType: "quick" },
      { sessionType: "standard" },
    ];
    const rows = buildHistoryJourneyRows(
      sits.map((sit, i) => ({
        sessionDate: "2026-10-27",
        sessionType: sit.sessionType,
        sortKey: String(i),
        data: sit,
      })),
    );

    const labels = rows.map(row =>
      row.kind === "session"
        ? historySessionLabel({ ...row.data, sessionIndexInDay: row.sessionIndexInDay })
        : row.kind,
    );
    expect(labels).toEqual(["Combined", "Quick", "Session 2"]);
  });
});
