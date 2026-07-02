import { describe, expect, test } from "vitest";
import { computeClearPercentFromLog } from "./mindStateSession";
import { loadSharedFixture, type ClearPercentFixture } from "./testing/sharedFixtures";

// Cross-platform parity: validates the web clear-percent against the shared golden
// set that iOS SessionLogic.calculateClearPercent also asserts (#421). Drift between
// the two duplicated implementations breaks CI on at least one platform.
describe("computeClearPercentFromLog — shared fixtures", () => {
  const fixture = loadSharedFixture<ClearPercentFixture>("clearPercent.json");

  test.each(fixture.cases)("$name", ({ log, endTime, expected }) => {
    expect(computeClearPercentFromLog(log, endTime)).toBe(expected);
  });
});
