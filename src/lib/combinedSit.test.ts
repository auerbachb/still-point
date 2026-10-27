import { describe, expect, test } from "vitest";
import {
  combinedDurationForUser,
  combinedSitField,
  isCombineOffered,
  previewNextCombinedDuration,
} from "./combinedSit";
import { FORK_DAY, MAX_DURATION } from "./constants";
import { tracksCredited } from "./sessionCalendar";
import { loadSharedFixture, type CombinedSitFixture } from "./testing/sharedFixtures";

describe("combined sit — shared fixture (#892)", () => {
  const fixture = loadSharedFixture<CombinedSitFixture>("combinedSit.json");

  test("every case group has cases", () => {
    expect(fixture.combinedDuration.length).toBeGreaterThan(0);
    expect(fixture.isCombineOffered.length).toBeGreaterThan(0);
    expect(fixture.tracksCredited.length).toBeGreaterThan(0);
  });

  test("both tracks at the cap are twice the 10-minute sit", () => {
    expect(combinedDurationForUser(FORK_DAY, FORK_DAY)).toBe(2 * MAX_DURATION);
  });

  test.each(fixture.combinedDuration)("combinedDurationForUser: $name", ({ currentDay, secondTrackDay, expected }) => {
    expect(combinedDurationForUser(currentDay, secondTrackDay)).toBe(expected);
  });

  test.each(fixture.isCombineOffered)(
    "isCombineOffered: $name",
    ({ dualTrackEnabled, primaryDoneToday, secondDoneToday, recoveryActive, expected }) => {
      expect(isCombineOffered({ dualTrackEnabled, primaryDoneToday, secondDoneToday, recoveryActive })).toBe(expected);
    },
  );

  test.each(fixture.tracksCredited)("tracksCredited: $name", ({ track, combined, expected }) => {
    expect(tracksCredited({ track, combined })).toEqual(expected);
  });
});

describe("previewNextCombinedDuration (#892)", () => {
  test("a completed sit previews both tracks a day on", () => {
    // Track One holds at the cap; Track Two goes from day 20 (250 s) to day 21 (260 s).
    expect(previewNextCombinedDuration({ completed: true, currentDay: 200, secondTrackDay: 20 })).toBe(860);
  });

  test("a sit ended early previews today's combined length again", () => {
    expect(previewNextCombinedDuration({ completed: false, currentDay: 200, secondTrackDay: 20 })).toBe(850);
  });

  test("both tracks at the cap stay at the cap", () => {
    expect(previewNextCombinedDuration({ completed: true, currentDay: 60, secondTrackDay: 55 })).toBe(1200);
  });
});

describe("combinedSitField (#892)", () => {
  test("a combined sit's payload gets the key, set to true", () => {
    expect(combinedSitField(true)).toEqual({ combined: true });
  });

  test("any other sit's payload gets no key at all", () => {
    expect(Object.keys(combinedSitField(false))).toEqual([]);
    expect(Object.keys(combinedSitField(undefined))).toEqual([]);
  });
});
