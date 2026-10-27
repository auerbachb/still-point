import { describe, expect, test } from "vitest";
import { focusSessionDuration } from "./duration";
import {
  focusActivityDayAfterCompletedSave,
  focusCountdownFontSize,
  focusRemainingSeconds,
  formatFocusCountdown,
  formatFocusGoal,
  resolveFocusEnd,
} from "./focusActivity";
import { FOCUS_ACTIVITIES } from "./focusActivityContent";
import { loadSharedFixture, type FocusActivityFixture } from "./testing/sharedFixtures";

const START = Date.UTC(2026, 9, 26, 12, 0, 0);
const at = (seconds: number) => START + seconds * 1000;

describe("formatFocusGoal (#836)", () => {
  test("reads in minutes under an hour", () => {
    expect(formatFocusGoal(60)).toBe("1 min");
    expect(formatFocusGoal(120)).toBe("2 min");
    expect(formatFocusGoal(1800)).toBe("30 min");
    expect(formatFocusGoal(3540)).toBe("59 min");
  });

  test("reads in hours and minutes from an hour", () => {
    expect(formatFocusGoal(3600)).toBe("1 hr");
    expect(formatFocusGoal(3660)).toBe("1 hr 1 min");
    expect(formatFocusGoal(5400)).toBe("1 hr 30 min");
    expect(formatFocusGoal(7200)).toBe("2 hr");
  });

  test("labels the goal ladder from the first goal to the cap", () => {
    expect(formatFocusGoal(focusSessionDuration(1))).toBe("1 min");
    expect(formatFocusGoal(focusSessionDuration(2))).toBe("2 min");
    expect(formatFocusGoal(focusSessionDuration(30))).toBe("30 min");
    expect(formatFocusGoal(focusSessionDuration(61))).toBe("1 hr 1 min");
    expect(formatFocusGoal(focusSessionDuration(120))).toBe("2 hr");
    expect(formatFocusGoal(focusSessionDuration(500))).toBe("2 hr");
  });
});

describe("formatFocusCountdown (#836)", () => {
  test("m:ss under an hour", () => {
    expect(formatFocusCountdown(0)).toBe("0:00");
    expect(formatFocusCountdown(1)).toBe("0:01");
    expect(formatFocusCountdown(59)).toBe("0:59");
    expect(formatFocusCountdown(60)).toBe("1:00");
    expect(formatFocusCountdown(1800)).toBe("30:00");
    expect(formatFocusCountdown(3599)).toBe("59:59");
  });

  test("h:mm:ss from an hour, so the cap reads 2:00:00", () => {
    expect(formatFocusCountdown(3600)).toBe("1:00:00");
    expect(formatFocusCountdown(3661)).toBe("1:01:01");
    expect(formatFocusCountdown(7199)).toBe("1:59:59");
    expect(formatFocusCountdown(7200)).toBe("2:00:00");
  });

  test("never shows a negative or fractional second", () => {
    expect(formatFocusCountdown(-5)).toBe("0:00");
    expect(formatFocusCountdown(59.9)).toBe("0:59");
  });
});

describe("focusCountdownFontSize (#836)", () => {
  const BREATH_SIZE = "min(120px, 22vw)";

  test("goals under an hour use the breath-counting digit size", () => {
    expect(focusCountdownFontSize(60)).toBe(BREATH_SIZE);
    expect(focusCountdownFontSize(1800)).toBe(BREATH_SIZE);
    expect(focusCountdownFontSize(3540)).toBe(BREATH_SIZE);
  });

  test("goals of an hour or more, which show h:mm:ss, get smaller digits", () => {
    // 16vw at 375px is 60px: seven monospace characters take about 250px.
    expect(focusCountdownFontSize(3600)).toBe("min(96px, 16vw)");
    expect(focusCountdownFontSize(7200)).toBe("min(96px, 16vw)");
  });
});

describe("focusRemainingSeconds (#836)", () => {
  test("counts down from the goal in whole seconds", () => {
    expect(focusRemainingSeconds(START, at(0), 60)).toBe(60);
    expect(focusRemainingSeconds(START, at(0.9), 60)).toBe(60);
    expect(focusRemainingSeconds(START, at(1), 60)).toBe(59);
    expect(focusRemainingSeconds(START, at(59.9), 60)).toBe(1);
  });

  test("reads 0 exactly when the goal has elapsed, and stays there", () => {
    expect(focusRemainingSeconds(START, at(60), 60)).toBe(0);
    expect(focusRemainingSeconds(START, at(600), 60)).toBe(0);
  });

  test("a clock that moved backwards shows the full goal", () => {
    expect(focusRemainingSeconds(START, at(-30), 60)).toBe(60);
  });
});

describe("resolveFocusEnd (#836)", () => {
  test("a countdown that ran out is completed at the goal", () => {
    expect(resolveFocusEnd({ startMs: START, nowMs: at(60), goalSeconds: 60, reason: "expired" })).toEqual({
      duration: 60,
      actualTime: 60,
      completed: true,
    });
  });

  test("expiry noticed late (a suspended tab) still saves the goal, not the overrun", () => {
    expect(resolveFocusEnd({ startMs: START, nowMs: at(5000), goalSeconds: 1800, reason: "expired" })).toEqual({
      duration: 1800,
      actualTime: 1800,
      completed: true,
    });
  });

  test("End early saves the whole seconds spent, not completed", () => {
    expect(resolveFocusEnd({ startMs: START, nowMs: at(20.4), goalSeconds: 120, reason: "ended" })).toEqual({
      duration: 120,
      actualTime: 20,
      completed: false,
    });
  });

  test("End before a whole second has passed saves nothing", () => {
    expect(resolveFocusEnd({ startMs: START, nowMs: at(0), goalSeconds: 60, reason: "ended" })).toBeNull();
    expect(resolveFocusEnd({ startMs: START, nowMs: at(0.9), goalSeconds: 60, reason: "ended" })).toBeNull();
  });

  test("End at one second is a real, ended-early session", () => {
    expect(resolveFocusEnd({ startMs: START, nowMs: at(1), goalSeconds: 60, reason: "ended" })).toEqual({
      duration: 60,
      actualTime: 1,
      completed: false,
    });
  });

  test("End at or after the goal counts as reaching it", () => {
    const completed = { duration: 60, actualTime: 60, completed: true };
    expect(resolveFocusEnd({ startMs: START, nowMs: at(60), goalSeconds: 60, reason: "ended" })).toEqual(completed);
    expect(resolveFocusEnd({ startMs: START, nowMs: at(95), goalSeconds: 60, reason: "ended" })).toEqual(completed);
  });

  test("End one second short of the goal is still ended early", () => {
    expect(resolveFocusEnd({ startMs: START, nowMs: at(59.99), goalSeconds: 60, reason: "ended" })).toEqual({
      duration: 60,
      actualTime: 59,
      completed: false,
    });
  });

  test("the two-hour cap resolves the same way", () => {
    expect(resolveFocusEnd({ startMs: START, nowMs: at(7200), goalSeconds: 7200, reason: "expired" })).toEqual({
      duration: 7200,
      actualTime: 7200,
      completed: true,
    });
    expect(resolveFocusEnd({ startMs: START, nowMs: at(3600), goalSeconds: 7200, reason: "ended" })).toEqual({
      duration: 7200,
      actualTime: 3600,
      completed: false,
    });
  });
});

describe("focusActivityDayAfterCompletedSave (#836)", () => {
  test("steps the goal counter by one, the rule the server applies", () => {
    expect(focusActivityDayAfterCompletedSave(1, 1)).toBe(2);
    expect(focusActivityDayAfterCompletedSave(30, 30)).toBe(31);
  });

  test("a missing counter is day 1", () => {
    expect(focusActivityDayAfterCompletedSave(undefined, 1)).toBe(2);
  });

  test("a server re-read that already applied the step is not stepped again", () => {
    // The session ran at day 4; the server answered day 5 before this merge.
    expect(focusActivityDayAfterCompletedSave(5, 4)).toBe(5);
  });

  test("never moves the counter backwards", () => {
    expect(focusActivityDayAfterCompletedSave(9, 4)).toBe(9);
  });

  test("keeps stepping past the goal cap: only the goal holds there", () => {
    expect(focusActivityDayAfterCompletedSave(120, 120)).toBe(121);
    expect(focusSessionDuration(121)).toBe(7200);
  });
});

// #840: the iOS suite (`FocusActivityLogicTests.swift`) reads the same file, so
// the rules the iOS timer duplicates from this one cannot drift apart.
describe("focus timer — shared fixture (#840)", () => {
  const fixture = loadSharedFixture<FocusActivityFixture>("focusActivity.json");
  const HOUR_FONT_SIZE = "min(96px, 16vw)";
  const MINUTE_FONT_SIZE = "min(120px, 22vw)";

  test("every case list has cases", () => {
    expect(fixture.formatGoal.length).toBeGreaterThan(0);
    expect(fixture.countdownDisplay.length).toBeGreaterThan(0);
    expect(fixture.countdownShowsHours.length).toBeGreaterThan(0);
    expect(fixture.remainingSeconds.length).toBeGreaterThan(0);
    expect(fixture.resolveEnd.length).toBeGreaterThan(0);
    expect(fixture.focusActivityDayAfterCompletedSave.length).toBeGreaterThan(0);
  });

  test.each(fixture.formatGoal)("formatFocusGoal $seconds", ({ seconds, expected }) => {
    expect(formatFocusGoal(seconds)).toBe(expected);
  });

  test.each(fixture.countdownDisplay)("formatFocusCountdown $seconds", ({ seconds, expected }) => {
    expect(formatFocusCountdown(seconds)).toBe(expected);
  });

  test.each(fixture.countdownShowsHours)("focusCountdownFontSize $goalSeconds", ({ goalSeconds, expected }) => {
    expect(focusCountdownFontSize(goalSeconds)).toBe(expected ? HOUR_FONT_SIZE : MINUTE_FONT_SIZE);
  });

  test.each(fixture.remainingSeconds)("focusRemainingSeconds: $name", ({ elapsedMs, goalSeconds, expected }) => {
    expect(focusRemainingSeconds(START, START + elapsedMs, goalSeconds)).toBe(expected);
  });

  test.each(fixture.resolveEnd)("resolveFocusEnd: $name", ({ elapsedMs, goalSeconds, reason, expected }) => {
    expect(resolveFocusEnd({ startMs: START, nowMs: START + elapsedMs, goalSeconds, reason })).toEqual(expected);
  });

  test.each(fixture.focusActivityDayAfterCompletedSave)(
    "focusActivityDayAfterCompletedSave: $name",
    ({ currentDay, sessionDay, expected }) => {
      expect(focusActivityDayAfterCompletedSave(currentDay, sessionDay)).toBe(expected);
    },
  );

  test("the picker's categories, in order, with their card copy", () => {
    expect(FOCUS_ACTIVITIES).toEqual(
      fixture.categories.map(({ id, label, description }) => ({ id, label, description })),
    );
  });
});
