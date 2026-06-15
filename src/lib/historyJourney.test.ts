import { describe, expect, test } from "vitest";
import {
  buildHistoryJourneyRows,
  sortSessionsForHistory,
  COLLAPSE_GAP_THRESHOLD_DAYS,
} from "./historyJourney";

describe("buildHistoryJourneyRows", () => {
  test("labels sequential sessions on the same calendar day", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-04-28", sortKey: "a", data: { id: "1" } },
      { sessionDate: "2026-04-28", sortKey: "b", data: { id: "2" } },
      { sessionDate: "2026-04-28", sortKey: "c", data: { id: "3" } },
    ]);
    expect(rows.map(r => (r.kind === "session" ? r.sessionIndexInDay : null))).toEqual([1, 2, 3]);
  });

  test("inserts per-day missed rows for short calendar gaps", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-04-26", sortKey: "a", data: { id: "1" } },
      { sessionDate: "2026-04-28", sortKey: "b", data: { id: "2" } },
    ]);
    expect(
      rows.map(r => {
        if (r.kind === "missed") return `missed:${r.date}`;
        if (r.kind === "collapsedGap") return `gap:${r.startDate}:${r.dayCount}`;
        return `session:${r.date}:${r.sessionIndexInDay}`;
      }),
    ).toEqual([
      "session:2026-04-26:1",
      "missed:2026-04-27",
      "session:2026-04-28:1",
    ]);
  });

  test("sorts by sessionDate then sortKey", () => {
    const sorted = sortSessionsForHistory([
      { sessionDate: "2026-04-28", sortKey: "b", data: 2 },
      { sessionDate: "2026-04-28", sortKey: "a", data: 1 },
      { sessionDate: "2026-04-27", sortKey: "z", data: 0 },
    ]);
    expect(sorted.map(s => s.data)).toEqual([0, 1, 2]);
  });

  // MARK: quick sits in the journey (#381 / iOS #379)

  test("quick-only sessions produce session rows", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-06-10", sessionType: "quick", sortKey: "q1", data: { id: "q1" } },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "session", sessionIndexInDay: 1, data: { id: "q1" } });
  });

  test("quick and standard mix uses per-type day indices", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-06-10", sessionType: "standard", sortKey: "2026-06-10T08:00:00.000Z", data: { id: "s1" } },
      { sessionDate: "2026-06-10", sessionType: "quick", sortKey: "2026-06-10T09:00:00.000Z", data: { id: "q1" } },
      { sessionDate: "2026-06-10", sessionType: "standard", sortKey: "2026-06-10T10:00:00.000Z", data: { id: "s2" } },
    ]);
    expect(rows).toHaveLength(3);
    // Chronological interleaving preserved...
    expect(rows.map(r => (r.kind === "session" ? (r.data as { id: string }).id : null))).toEqual(["s1", "q1", "s2"]);
    // ...while standard numbering ignores the quick sit in between.
    expect(rows.map(r => (r.kind === "session" ? r.sessionIndexInDay : null))).toEqual([1, 1, 2]);
  });

  // MARK: gap collapsing (#381 / iOS #379)

  test("two missed days stay as per-day missed rows", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-06-01", sortKey: "a", data: { id: "a" } },
      { sessionDate: "2026-06-04", sortKey: "b", data: { id: "b" } },
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({ kind: "missed", date: "2026-06-02" });
    expect(rows[2]).toEqual({ kind: "missed", date: "2026-06-03" });
  });

  test("three missed days collapse to a single range (threshold boundary)", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-06-01", sortKey: "a", data: { id: "a" } },
      { sessionDate: "2026-06-05", sortKey: "b", data: { id: "b" } },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({ kind: "collapsedGap", startDate: "2026-06-02", endDate: "2026-06-04", dayCount: 3 });
    expect(COLLAPSE_GAP_THRESHOLD_DAYS).toBe(3);
  });

  test("a 30-day gap collapses to one range and keeps the prior session reachable", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-04-01", sortKey: "a", data: { id: "a" } },
      { sessionDate: "2026-05-01", sortKey: "b", data: { id: "b" } },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "session", data: { id: "a" } });
    expect(rows[1]).toEqual({ kind: "collapsedGap", startDate: "2026-04-02", endDate: "2026-04-30", dayCount: 29 });
    expect(rows[2]).toMatchObject({ kind: "session", data: { id: "b" } });
  });

  test("a gap spanning standard then quick sessions still collapses", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2026-04-01", sessionType: "standard", sortKey: "a", data: { id: "s1" } },
      { sessionDate: "2026-05-06", sessionType: "quick", sortKey: "b", data: { id: "q1" } },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual({ kind: "collapsedGap", startDate: "2026-04-02", endDate: "2026-05-05", dayCount: 34 });
    expect(rows[2]).toMatchObject({ kind: "session", data: { id: "q1" } });
  });

  // MARK: gap adjacent to today (#381 / iOS #379)

  test("a long gap between the last session and today collapses", () => {
    const rows = buildHistoryJourneyRows(
      [{ sessionDate: "2026-05-01", sortKey: "a", data: { id: "a" } }],
      "2026-06-11",
    );
    expect(rows).toHaveLength(2);
    // today itself is never emitted as missed.
    expect(rows[1]).toEqual({ kind: "collapsedGap", startDate: "2026-05-02", endDate: "2026-06-10", dayCount: 40 });
  });

  test("a short trailing gap emits per-day missed rows", () => {
    const rows = buildHistoryJourneyRows(
      [{ sessionDate: "2026-06-09", sortKey: "a", data: { id: "a" } }],
      "2026-06-11",
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ kind: "missed", date: "2026-06-10" });
  });

  test("no trailing gap when the last session is today", () => {
    const rows = buildHistoryJourneyRows(
      [{ sessionDate: "2026-06-11", sortKey: "a", data: { id: "a" } }],
      "2026-06-11",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "session" });
  });

  test("no trailing gap when the last session was yesterday", () => {
    const rows = buildHistoryJourneyRows(
      [{ sessionDate: "2026-06-10", sortKey: "a", data: { id: "a" } }],
      "2026-06-11",
    );
    expect(rows).toHaveLength(1);
  });

  test("empty sessions produce no rows", () => {
    expect(buildHistoryJourneyRows([], "2026-06-11")).toEqual([]);
  });

  test("very large calendar gaps collapse to one range (no per-day cap)", () => {
    const rows = buildHistoryJourneyRows([
      { sessionDate: "2020-01-01", sortKey: "a", data: { id: "1" } },
      { sessionDate: "2030-01-01", sortKey: "b", data: { id: "2" } },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.filter(r => r.kind === "missed")).toHaveLength(0);
    expect(rows[1]).toMatchObject({ kind: "collapsedGap", startDate: "2020-01-02", endDate: "2029-12-31" });
  });
});
