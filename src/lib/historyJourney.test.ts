import { describe, expect, test } from "vitest";
import { buildHistoryJourneyRows, sortSessionsForHistory } from "./historyJourney";

describe("buildHistoryJourneyRows", () => {
  test("labels sequential sessions on the same calendar day", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-04-28", sortKey: "a", data: { id: "1" } },
      { sessionDate: "2026-04-28", sortKey: "b", data: { id: "2" } },
      { sessionDate: "2026-04-28", sortKey: "c", data: { id: "3" } },
    ]);
    expect(rows.filter(r => r.kind === "session").map(r => r.sessionIndexInDay)).toEqual([1, 2, 3]);
  });

  test("inserts missed rows for calendar gaps", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-04-26", sortKey: "a", data: { id: "1" } },
      { sessionDate: "2026-04-28", sortKey: "b", data: { id: "2" } },
    ]);
    expect(rows.map(r => (r.kind === "missed" ? `missed:${r.date}` : `session:${r.date}:${r.sessionIndexInDay}`))).toEqual([
      "session:2026-04-26:1",
      "missed:2026-04-27",
      "session:2026-04-28:1",
    ]);
  });

  test("sorts by date then sortKey", () => {
    const sorted = sortSessionsForHistory([
      { sessionDate: "2026-04-28", sortKey: "b", data: 2 },
      { sessionDate: "2026-04-28", sortKey: "a", data: 1 },
      { sessionDate: "2026-04-27", sortKey: "z", data: 0 },
    ]);
    expect(sorted.map(s => s.data)).toEqual([0, 1, 2]);
  });
});
