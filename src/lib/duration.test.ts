import { describe, expect, test } from "vitest";
import { FORK_DAY, MAX_DURATION, durationForDay } from "./constants";
import {
  activeRecovery,
  advanceProgression,
  advanceSecondTrackDay,
  detectMissedDayGap,
  isDualTrackEligible,
  recoveryStepDuration,
  recoveryTotalStepsFor,
  sessionDurationForUser,
  startRecovery,
  type ProgressionState,
} from "./duration";
import { loadSharedFixture, type DurationForDayFixture } from "./testing/sharedFixtures";

const NO_RECOVERY = { recoveryTargetDay: null, recoveryCurrentStep: null, recoveryTotalSteps: null };

describe("durationForDay 10-minute cap (#240)", () => {
  test("grows 10s/day up to the cap, then holds at 10 minutes", () => {
    expect(durationForDay(54)).toBe(590);
    expect(durationForDay(FORK_DAY)).toBe(MAX_DURATION); // day 55 = 600s
    expect(durationForDay(56)).toBe(MAX_DURATION);
    expect(durationForDay(200)).toBe(MAX_DURATION);
  });

  test("FORK_DAY is the first day that reaches the cap", () => {
    expect(FORK_DAY).toBe(55);
    expect(durationForDay(FORK_DAY - 1)).toBeLessThan(MAX_DURATION);
  });
});

describe("isDualTrackEligible (#240)", () => {
  test("only eligible after passing the 10-minute (day-55) sit", () => {
    expect(isDualTrackEligible(1)).toBe(false);
    expect(isDualTrackEligible(FORK_DAY)).toBe(false); // on day 55, the 10-min sit isn't done yet
    expect(isDualTrackEligible(FORK_DAY + 1)).toBe(true); // day 56 = after the 10-min sit
    expect(isDualTrackEligible(120)).toBe(true);
  });
});

describe("advanceSecondTrackDay (#240)", () => {
  test("a completed standard sit bumps the second-track counter by one", () => {
    expect(advanceSecondTrackDay("standard", true, 1)).toBe(2);
    expect(advanceSecondTrackDay("standard", true, 12)).toBe(13);
  });

  test("quick and incomplete sits never advance the second track", () => {
    expect(advanceSecondTrackDay("quick", true, 3)).toBe(3);
    expect(advanceSecondTrackDay("standard", false, 3)).toBe(3);
    expect(advanceSecondTrackDay("breath", true, 3)).toBe(3);
  });

  test("second-track duration caps at 10 minutes like the primary track", () => {
    expect(sessionDurationForUser("standard", 1, NO_RECOVERY)).toBe(60);
    expect(sessionDurationForUser("standard", FORK_DAY + 10, NO_RECOVERY)).toBe(MAX_DURATION);
  });
});

describe("recoveryTotalStepsFor", () => {
  test("day 1 (nothing lost) needs zero steps", () => {
    expect(recoveryTotalStepsFor(1)).toBe(0);
  });

  test("small progress ramps day-by-day (fewer than 5 steps)", () => {
    expect(recoveryTotalStepsFor(2)).toBe(1);
    expect(recoveryTotalStepsFor(3)).toBe(2);
    expect(recoveryTotalStepsFor(6)).toBe(5);
  });

  test("caps at RECOVERY_MAX_STEPS for long streaks", () => {
    expect(recoveryTotalStepsFor(7)).toBe(5);
    expect(recoveryTotalStepsFor(50)).toBe(5);
  });

  test("never negative for defensive inputs", () => {
    expect(recoveryTotalStepsFor(0)).toBe(0);
    expect(recoveryTotalStepsFor(-3)).toBe(0);
  });
});

describe("recoveryStepDuration", () => {
  test("step 1 always resets to exactly 1 minute", () => {
    expect(recoveryStepDuration(3, 2, 1)).toBe(60);
    expect(recoveryStepDuration(11, 5, 1)).toBe(60);
  });

  test("short recovery (<=5 days lost) walks the same 10s/day schedule as normal progression", () => {
    // currentDay=3 -> totalSteps=2 -> ramp = (durationForDay(3)-60)/2 = (80-60)/2 = 10
    const totalSteps = recoveryTotalStepsFor(3);
    expect(recoveryStepDuration(3, totalSteps, 1)).toBe(durationForDay(1));
    expect(recoveryStepDuration(3, totalSteps, 2)).toBe(durationForDay(2));
    // The day after recovery completes (currentDay unchanged at 3) rejoins exactly:
    expect(durationForDay(3)).toBe(80);
  });

  test("day 6 (5 days lost): 5 steps land on 60,70,80,90,100; normal day 6 is 110", () => {
    const totalSteps = recoveryTotalStepsFor(6);
    expect(totalSteps).toBe(5);
    expect([1, 2, 3, 4, 5].map((s) => recoveryStepDuration(6, totalSteps, s))).toEqual([
      60, 70, 80, 90, 100,
    ]);
    expect(durationForDay(6)).toBe(110);
  });

  test("long recovery (>5 days lost) is capped at 5 steps with a bigger ramp", () => {
    // currentDay=11 -> priorDuration=160, difference=100, totalSteps=5, ramp=20/step
    const totalSteps = recoveryTotalStepsFor(11);
    expect(totalSteps).toBe(5);
    expect([1, 2, 3, 4, 5].map((s) => recoveryStepDuration(11, totalSteps, s))).toEqual([
      60, 80, 100, 120, 140,
    ]);
    // Next (non-recovery) session after the ramp jumps straight to the true prior level.
    expect(durationForDay(11)).toBe(160);
  });

  test("handles a difference not evenly divisible by totalSteps without float drift", () => {
    // currentDay=3 -> priorDuration=80, difference=20, totalSteps=3, ramp=6.666...
    // All output durations must be integers even though the ramp is non-terminating.
    // step 1 = Math.round(60 + 6.666*0) = 60
    // step 2 = Math.round(60 + 6.666*1) = Math.round(66.666) = 67
    // step 3 = Math.round(60 + 6.666*2) = Math.round(73.333) = 73
    const results = [1, 2, 3].map((s) => recoveryStepDuration(3, 3, s));
    for (const r of results) {
      expect(Number.isInteger(r)).toBe(true);
    }
    expect(results).toEqual([60, 67, 73]);
  });

  test("totalSteps=0 always returns BASE_DURATION", () => {
    expect(recoveryStepDuration(1, 0, 1)).toBe(60);
  });

  test("step is clamped into [1, totalSteps]", () => {
    const totalSteps = recoveryTotalStepsFor(6);
    expect(recoveryStepDuration(6, totalSteps, 0)).toBe(recoveryStepDuration(6, totalSteps, 1));
    expect(recoveryStepDuration(6, totalSteps, 99)).toBe(recoveryStepDuration(6, totalSteps, totalSteps));
  });
});

describe("activeRecovery", () => {
  test("null when any field is missing", () => {
    expect(activeRecovery(NO_RECOVERY)).toBeNull();
    expect(activeRecovery({ recoveryTargetDay: 5, recoveryCurrentStep: 1, recoveryTotalSteps: null })).toBeNull();
  });

  test("null when totalSteps is zero or step is out of range", () => {
    expect(activeRecovery({ recoveryTargetDay: 1, recoveryCurrentStep: 1, recoveryTotalSteps: 0 })).toBeNull();
    expect(activeRecovery({ recoveryTargetDay: 6, recoveryCurrentStep: 6, recoveryTotalSteps: 5 })).toBeNull();
    expect(activeRecovery({ recoveryTargetDay: 6, recoveryCurrentStep: 0, recoveryTotalSteps: 5 })).toBeNull();
  });

  test("returns the concrete recovery when in progress", () => {
    expect(activeRecovery({ recoveryTargetDay: 6, recoveryCurrentStep: 2, recoveryTotalSteps: 5 })).toEqual({
      recoveryTargetDay: 6,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 5,
    });
  });
});

describe("startRecovery", () => {
  test("returns null for day 1 (nothing to recover)", () => {
    expect(startRecovery(1)).toBeNull();
  });

  test("freezes targetDay at currentDay and starts at step 1", () => {
    expect(startRecovery(11)).toEqual({ recoveryTargetDay: 11, recoveryCurrentStep: 1, recoveryTotalSteps: 5 });
    expect(startRecovery(3)).toEqual({ recoveryTargetDay: 3, recoveryCurrentStep: 1, recoveryTotalSteps: 2 });
  });
});

describe("sessionDurationForUser", () => {
  test("quick sessions always use QUICK_DURATION regardless of recovery", () => {
    expect(sessionDurationForUser("quick", 20, NO_RECOVERY)).toBe(60);
    expect(sessionDurationForUser("quick", 20, { recoveryTargetDay: 20, recoveryCurrentStep: 1, recoveryTotalSteps: 5 })).toBe(60);
  });

  test("standard sessions use normal duration when not in recovery", () => {
    expect(sessionDurationForUser("standard", 5, NO_RECOVERY)).toBe(durationForDay(5));
  });

  test("standard sessions use the recovery ramp when active", () => {
    const recovery = { recoveryTargetDay: 11, recoveryCurrentStep: 3, recoveryTotalSteps: 5 };
    expect(sessionDurationForUser("standard", 11, recovery)).toBe(100);
  });
});

describe("detectMissedDayGap", () => {
  const base = { currentDay: 11, recovery: NO_RECOVERY };

  test("no gap detected with fewer than 2 days between sessions", () => {
    expect(detectMissedDayGap({ ...base, lastCompletedSessionDate: "2026-06-10", todayIso: "2026-06-11" })).toBeNull();
    expect(detectMissedDayGap({ ...base, lastCompletedSessionDate: "2026-06-11", todayIso: "2026-06-11" })).toBeNull();
  });

  test("starts recovery on a 2+ day gap", () => {
    expect(detectMissedDayGap({ ...base, lastCompletedSessionDate: "2026-06-09", todayIso: "2026-06-11" })).toEqual({
      recoveryTargetDay: 11,
      recoveryCurrentStep: 1,
      recoveryTotalSteps: 5,
    });
  });

  test("larger gaps still cap totalSteps at 5", () => {
    expect(detectMissedDayGap({ ...base, lastCompletedSessionDate: "2026-05-01", todayIso: "2026-06-11" })).toEqual({
      recoveryTargetDay: 11,
      recoveryCurrentStep: 1,
      recoveryTotalSteps: 5,
    });
  });

  test("no-op when there is no prior completed session", () => {
    expect(detectMissedDayGap({ ...base, lastCompletedSessionDate: null, todayIso: "2026-06-11" })).toBeNull();
  });

  test("no-op when already in recovery (does not restart the ramp)", () => {
    const inRecovery = { recoveryTargetDay: 11, recoveryCurrentStep: 3, recoveryTotalSteps: 5 };
    expect(
      detectMissedDayGap({
        currentDay: 11,
        recovery: inRecovery,
        lastCompletedSessionDate: "2026-05-01",
        todayIso: "2026-06-11",
      }),
    ).toBeNull();
  });

  test("no-op on day 1 even with a large gap (nothing to recover)", () => {
    expect(
      detectMissedDayGap({ currentDay: 1, recovery: NO_RECOVERY, lastCompletedSessionDate: "2026-05-01", todayIso: "2026-06-11" }),
    ).toBeNull();
  });
});

describe("advanceProgression", () => {
  test("quick sessions never advance", () => {
    expect(advanceProgression("quick", true, { currentDay: 5, ...NO_RECOVERY })).toEqual({
      currentDay: 5,
      ...NO_RECOVERY,
    });
  });

  test("incomplete standard sessions never advance", () => {
    expect(advanceProgression("standard", false, { currentDay: 5, ...NO_RECOVERY })).toEqual({
      currentDay: 5,
      ...NO_RECOVERY,
    });
  });

  test("completed standard session outside recovery bumps currentDay by one", () => {
    expect(advanceProgression("standard", true, { currentDay: 5, ...NO_RECOVERY })).toEqual({
      currentDay: 6,
      ...NO_RECOVERY,
    });
  });

  test("completed standard session mid-recovery advances the step, leaving currentDay untouched", () => {
    const state = { currentDay: 11, recoveryTargetDay: 11, recoveryCurrentStep: 2, recoveryTotalSteps: 5 };
    expect(advanceProgression("standard", true, state)).toEqual({
      currentDay: 11,
      recoveryTargetDay: 11,
      recoveryCurrentStep: 3,
      recoveryTotalSteps: 5,
    });
  });

  test("completing the final recovery step clears recovery and advances currentDay (#559)", () => {
    const state = { currentDay: 11, recoveryTargetDay: 11, recoveryCurrentStep: 5, recoveryTotalSteps: 5 };
    expect(advanceProgression("standard", true, state)).toEqual({
      currentDay: 12,
      recoveryTargetDay: null,
      recoveryCurrentStep: null,
      recoveryTotalSteps: null,
    });
  });

  test("an incomplete standard session mid-recovery does not advance the step", () => {
    const state = { currentDay: 11, recoveryTargetDay: 11, recoveryCurrentStep: 2, recoveryTotalSteps: 5 };
    expect(advanceProgression("standard", false, state)).toEqual(state);
  });

  test("after recovery clears, the next completed session resumes normal progression", () => {
    const cleared = { currentDay: 12, recoveryTargetDay: null, recoveryCurrentStep: null, recoveryTotalSteps: null };
    expect(advanceProgression("standard", true, cleared)).toEqual({
      currentDay: 13,
      recoveryTargetDay: null,
      recoveryCurrentStep: null,
      recoveryTotalSteps: null,
    });
  });

  test("repeated miss gaps after recovery no longer stall progression (#559)", () => {
    let state: ProgressionState = { currentDay: 45, ...NO_RECOVERY };

    const completeRecoveryCycle = () => {
      state = {
        ...state,
        recoveryTargetDay: state.currentDay,
        recoveryCurrentStep: 1,
        recoveryTotalSteps: 5,
      };
      for (let step = 1; step <= 5; step++) {
        state = { ...state, recoveryCurrentStep: step };
        state = advanceProgression("standard", true, state);
      }
    };

    completeRecoveryCycle();
    expect(state.currentDay).toBe(46);
    expect(activeRecovery(state)).toBeNull();

    const gapRecovery = detectMissedDayGap({
      lastCompletedSessionDate: "2026-06-01",
      todayIso: "2026-06-04",
      currentDay: state.currentDay,
      recovery: state,
    });
    expect(gapRecovery).toEqual({
      recoveryTargetDay: 46,
      recoveryCurrentStep: 1,
      recoveryTotalSteps: 5,
    });

    state = { ...state, ...gapRecovery! };
    completeRecoveryCycle();
    expect(state.currentDay).toBe(47);
    expect(durationForDay(state.currentDay)).toBe(520);
  });

  test("cap-boundary progression climbs past 500s toward 600s after recovery", () => {
    let state: ProgressionState = { currentDay: 54, ...NO_RECOVERY };
    expect(durationForDay(state.currentDay)).toBe(590);

    state = advanceProgression("standard", true, state);
    expect(state.currentDay).toBe(55);
    expect(durationForDay(state.currentDay)).toBe(MAX_DURATION);

    state = advanceProgression("standard", true, state);
    expect(state.currentDay).toBe(56);
    expect(durationForDay(state.currentDay)).toBe(MAX_DURATION);
  });
});

describe("duration + progression — shared fixtures (#540/#421)", () => {
  const fixture = loadSharedFixture<DurationForDayFixture>("durationForDay.json");

  test("constants match implementation", () => {
    expect(fixture.constants.forkDay).toBe(FORK_DAY);
    expect(fixture.constants.maxDuration).toBe(MAX_DURATION);
  });

  test.each(fixture.durationForDay)("durationForDay day $day", ({ day, expected }) => {
    expect(durationForDay(day)).toBe(expected);
  });

  test.each(fixture.isDualTrackEligible)("isDualTrackEligible currentDay $currentDay", ({ currentDay, expected }) => {
    expect(isDualTrackEligible(currentDay)).toBe(expected);
  });

  test.each(fixture.advanceProgression)("$name", ({ sessionType, completed, state, expected }) => {
    expect(advanceProgression(sessionType, completed, state)).toEqual(expected);
  });

  test.each(fixture.detectMissedDayGap)("$name", ({ lastCompletedSessionDate, todayIso, currentDay, recovery, expected }) => {
    expect(detectMissedDayGap({ lastCompletedSessionDate, todayIso, currentDay, recovery })).toEqual(expected);
  });

  test.each(fixture.recoveryStepDuration ?? [])("$name", ({ targetDay, totalSteps, step, expected }) => {
    expect(recoveryStepDuration(targetDay, totalSteps, step)).toBe(expected);
  });
});
