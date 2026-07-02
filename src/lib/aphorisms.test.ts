import { describe, expect, test } from "vitest";
import { APHORISMS, aphorismForDay } from "./aphorisms";
import { loadSharedFixture, type AphorismsFixture } from "./testing/sharedFixtures";

describe("APHORISMS", () => {
  test("every entry has non-empty text and author", () => {
    expect(APHORISMS.length).toBeGreaterThan(0);
    for (const { text, author } of APHORISMS) {
      expect(text.trim().length).toBeGreaterThan(0);
      expect(author.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("aphorismForDay", () => {
  test("is deterministic for a given day", () => {
    expect(aphorismForDay(3)).toEqual(aphorismForDay(3));
  });

  test("rotates through the list as the day advances", () => {
    const first = aphorismForDay(1);
    const wrapped = aphorismForDay(1 + APHORISMS.length);
    expect(wrapped).toEqual(first);
  });

  test("clamps non-finite or sub-1 input to day 1", () => {
    expect(aphorismForDay(0)).toEqual(aphorismForDay(1));
    expect(aphorismForDay(-5)).toEqual(aphorismForDay(1));
    expect(aphorismForDay(Number.NaN)).toEqual(aphorismForDay(1));
  });

  test("always returns a value from the content list", () => {
    for (let day = 1; day <= APHORISMS.length * 2; day++) {
      expect(APHORISMS).toContainEqual(aphorismForDay(day));
    }
  });
});

// Cross-platform parity: the same day->index golden set is asserted by iOS
// Aphorisms.forDay (#421). `expectedCount` locks the shared list length.
describe("aphorismForDay — shared fixtures", () => {
  const fixture = loadSharedFixture<AphorismsFixture>("aphorisms.json");

  test("list length matches the shared fixture", () => {
    expect(APHORISMS.length).toBe(fixture.expectedCount);
  });

  test.each(fixture.cases)("day $day resolves to index $expectedIndex", ({ day, expectedIndex }) => {
    expect(aphorismForDay(day)).toEqual(APHORISMS[expectedIndex]);
  });
});
