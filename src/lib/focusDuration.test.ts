/**
 * Issue #835 (focus activity tracking 1/5, #765): the focus session type, its
 * goal ramp, and the guarantee that a focus session never moves the meditation
 * ramp. The existing meditation tests and `shared/test-fixtures/durationForDay.json`
 * stay as they are; this file only adds coverage.
 */
import { describe, expect, test } from "vitest";
import {
  BASE_DURATION,
  FOCUS_DURATION_CONFIG,
  INCREMENT,
  MAX_DURATION,
  MEDITATION_DURATION_CONFIG,
  durationForDay,
  durationForSession,
  focusDurationForDay,
  isSessionType,
  parseOptionalSessionType,
  rampDurationForDay,
  shouldAdvanceDay,
  shouldAdvanceFocusDay,
  type SessionType,
} from "./constants";
import {
  advanceFocusActivityDay,
  advanceProgression,
  advanceSecondTrackDay,
  focusSessionDuration,
  sessionDurationForUser,
} from "./duration";

const ALL_SESSION_TYPES: readonly SessionType[] = ["standard", "quick", "breath", "focus"];
const NO_RECOVERY = { recoveryTargetDay: null, recoveryCurrentStep: null, recoveryTotalSteps: null };
const ACTIVE_RECOVERY = { recoveryTargetDay: 11, recoveryCurrentStep: 3, recoveryTotalSteps: 5 };

describe("focus session type (#835)", () => {
  test("focus is a valid session type", () => {
    expect(isSessionType("focus")).toBe(true);
    expect(parseOptionalSessionType("focus")).toBe("focus");
  });

  test("type names stay case-sensitive and a missing type is still standard", () => {
    expect(isSessionType("Focus")).toBe(false);
    expect(parseOptionalSessionType("Focus")).toBeNull();
    expect(parseOptionalSessionType(undefined)).toBe("standard");
  });
});

describe("rampDurationForDay (#835)", () => {
  test("the meditation config reproduces the pre-#835 durationForDay formula", () => {
    for (let day = -3; day <= 200; day++) {
      const legacy = Math.min(MAX_DURATION, BASE_DURATION + (Math.max(day, 1) - 1) * INCREMENT);
      expect(rampDurationForDay(day, MEDITATION_DURATION_CONFIG)).toBe(legacy);
      expect(durationForDay(day)).toBe(legacy);
    }
  });

  test("durationForDay is unchanged at days 1, 55 and 100", () => {
    expect(durationForDay(1)).toBe(60);
    expect(durationForDay(55)).toBe(600);
    expect(durationForDay(100)).toBe(600);
  });

  test("applies any config: base on day 1, +increment a day, held at the cap", () => {
    const config = { base: 30, increment: 15, cap: 90 };
    expect(rampDurationForDay(1, config)).toBe(30);
    expect(rampDurationForDay(2, config)).toBe(45);
    expect(rampDurationForDay(5, config)).toBe(90);
    expect(rampDurationForDay(50, config)).toBe(90);
  });
});

describe("focusDurationForDay (#835)", () => {
  test("FOCUS_DURATION_CONFIG is one minute, +1 minute a session, capped at two hours", () => {
    expect(FOCUS_DURATION_CONFIG).toEqual({ base: 60, increment: 60, cap: 7200 });
  });

  test("starts at one minute and climbs a minute per day", () => {
    expect(focusDurationForDay(1)).toBe(60);
    expect(focusDurationForDay(2)).toBe(120);
    expect(focusDurationForDay(30)).toBe(1800);
    expect(focusDurationForDay(119)).toBe(7140);
  });

  test("day 120 is the first capped day and the goal holds there", () => {
    expect(focusDurationForDay(120)).toBe(7200);
    expect(focusDurationForDay(121)).toBe(7200);
    expect(focusDurationForDay(1000)).toBe(7200);
  });

  test("days below 1 behave as day 1", () => {
    expect(focusDurationForDay(0)).toBe(60);
    expect(focusDurationForDay(-5)).toBe(60);
  });

  test("never exceeds the cap", () => {
    for (let day = -10; day <= 2000; day++) {
      expect(focusDurationForDay(day)).toBeLessThanOrEqual(FOCUS_DURATION_CONFIG.cap);
    }
  });
});

describe("shouldAdvanceFocusDay (#835)", () => {
  test.each(ALL_SESSION_TYPES.flatMap((sessionType) => [
    { sessionType, completed: true },
    { sessionType, completed: false },
  ]))("$sessionType, completed $completed", ({ sessionType, completed }) => {
    expect(shouldAdvanceFocusDay(sessionType, completed)).toBe(completed && sessionType === "focus");
  });

  test("a completed focus session never advances the meditation day", () => {
    expect(shouldAdvanceDay("focus", true)).toBe(false);
    expect(advanceSecondTrackDay("focus", true, 3)).toBe(3);
    const state = { currentDay: 11, ...ACTIVE_RECOVERY };
    expect(advanceProgression("focus", true, state)).toEqual(state);
  });
});

describe("advanceFocusActivityDay (#835)", () => {
  test("a completed focus session steps the goal counter by one", () => {
    expect(advanceFocusActivityDay("focus", true, 1)).toBe(2);
    expect(advanceFocusActivityDay("focus", true, 119)).toBe(120);
  });

  test("an ended-early focus session and every meditation sit leave it alone", () => {
    expect(advanceFocusActivityDay("focus", false, 4)).toBe(4);
    expect(advanceFocusActivityDay("standard", true, 4)).toBe(4);
    expect(advanceFocusActivityDay("quick", true, 4)).toBe(4);
    expect(advanceFocusActivityDay("breath", true, 4)).toBe(4);
  });
});

describe("focus durations through the shared dispatchers (#835)", () => {
  test("focusSessionDuration is the focus goal for a focusActivityDay", () => {
    expect(focusSessionDuration(1)).toBe(60);
    expect(focusSessionDuration(5)).toBe(300);
    expect(focusSessionDuration(500)).toBe(7200);
  });

  test("durationForSession routes focus to the focus goal, not the meditation ramp", () => {
    expect(durationForSession("focus", 3)).toBe(180);
    expect(durationForSession("focus", 200)).toBe(7200);
    expect(durationForSession("standard", 3)).toBe(80);
    expect(durationForSession("breath", 3)).toBe(80);
    expect(durationForSession("quick", 3)).toBe(60);
  });

  test("sessionDurationForUser gives focus its goal and ignores the meditation recovery ramp", () => {
    expect(sessionDurationForUser("focus", 3, NO_RECOVERY)).toBe(180);
    expect(sessionDurationForUser("focus", 3, ACTIVE_RECOVERY)).toBe(180);
    // The same recovery state does change a standard sit's length.
    expect(sessionDurationForUser("standard", 11, ACTIVE_RECOVERY)).toBe(100);
  });
});
