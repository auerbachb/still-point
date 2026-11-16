import { describe, expect, test } from "vitest";
import {
  SAND_CARRY_SHARE,
  SAND_MAX_TRIPS,
  SAND_SECONDS_PER_TRIP,
  SAND_WALK_SECONDS,
  sandProgress,
  sandTripCount,
} from "./sandProgress";

describe("sandProgress piles", () => {
  test("at 0% the source is full and the destination is empty", () => {
    const state = sandProgress(0, 600);
    expect(state.fraction).toBe(0);
    expect(state.sourceFraction).toBe(1);
    expect(state.destinationFraction).toBe(0);
    expect(state.complete).toBe(false);
  });

  test("mid-session the piles split the sand evenly", () => {
    const state = sandProgress(300, 600);
    expect(state.fraction).toBe(0.5);
    expect(state.sourceFraction).toBe(0.5);
    expect(state.destinationFraction).toBe(0.5);
  });

  test("at 100% the source is empty and the destination is full", () => {
    const state = sandProgress(600, 600);
    expect(state.fraction).toBe(1);
    expect(state.sourceFraction).toBe(0);
    expect(state.destinationFraction).toBe(1);
    expect(state.complete).toBe(true);
  });

  test("piles always sum to a full pile", () => {
    for (const elapsed of [0, 1.25, 77, 301.5, 599, 600]) {
      const state = sandProgress(elapsed, 600);
      expect(state.sourceFraction + state.destinationFraction).toBeCloseTo(1, 10);
    }
  });

  test("complete becomes true only at full progress", () => {
    expect(sandProgress(599.999, 600).complete).toBe(false);
    expect(sandProgress(600, 600).complete).toBe(true);
  });

  test("elapsed past the end clamps to a complete sit", () => {
    const state = sandProgress(900, 600);
    expect(state.fraction).toBe(1);
    expect(state.sourceFraction).toBe(0);
    expect(state.complete).toBe(true);
  });

  test("negative or non-finite elapsed is treated as zero", () => {
    expect(sandProgress(-5, 600).fraction).toBe(0);
    expect(sandProgress(Number.NaN, 600).fraction).toBe(0);
    expect(sandProgress(Number.POSITIVE_INFINITY, 600).fraction).toBe(0);
  });
});

describe("sandProgress carrier", () => {
  test("carrier stays within the route", () => {
    for (let elapsed = 0; elapsed <= 600; elapsed += 0.7) {
      const { carrierPosition } = sandProgress(elapsed, 600);
      expect(carrierPosition).toBeGreaterThanOrEqual(0);
      expect(carrierPosition).toBeLessThanOrEqual(1);
    }
  });

  test("carrier starts at the source and carries sand forward", () => {
    const start = sandProgress(0, 600);
    expect(start.carrierPosition).toBe(0);
    expect(start.carrying).toBe(true);
  });

  test("carrier rests at the destination once the sit is complete", () => {
    const done = sandProgress(600, 600);
    expect(done.carrierPosition).toBe(1);
    expect(done.carrying).toBe(false);
  });

  test("the return leg after the carry share is empty-handed", () => {
    // Trip length for a 600s sit is 600 / 10 = 60s; sample the return leg.
    const tripLength = 600 / sandTripCount(600);
    const returning = sandProgress(tripLength * (SAND_CARRY_SHARE + 0.1), 600);
    expect(returning.carrying).toBe(false);
  });

  test("the carrier repeats trips rather than stalling after one", () => {
    const tripLength = 600 / sandTripCount(600);
    const firstTrip = sandProgress(tripLength * 0.35, 600);
    const secondTrip = sandProgress(tripLength * 1.35, 600);
    expect(secondTrip.carrierPosition).toBeCloseTo(firstTrip.carrierPosition, 10);
  });
});

describe("sandProgress pause and resume", () => {
  test("identical elapsed values give identical state (paused carrier holds still)", () => {
    const first = sandProgress(123.456, 600);
    const again = sandProgress(123.456, 600);
    expect(again).toEqual(first);
  });

  test("resuming continues from the same progress", () => {
    const beforePause = sandProgress(200, 600);
    const afterResume = sandProgress(200 + 0.05, 600);
    expect(afterResume.fraction).toBeGreaterThan(beforePause.fraction);
    expect(afterResume.destinationFraction - beforePause.destinationFraction).toBeCloseTo(0.05 / 600, 10);
  });

  test("walk phase is derived from elapsed time and stays in [0, 1)", () => {
    for (const elapsed of [0, 0.5, 1.99, 2, 1000.37]) {
      const { walkPhase } = sandProgress(elapsed, 600);
      expect(walkPhase).toBeGreaterThanOrEqual(0);
      expect(walkPhase).toBeLessThan(1);
    }
    expect(sandProgress(SAND_WALK_SECONDS, 600).walkPhase).toBe(0);
  });
});

describe("sandProgress non-integer and extreme sit lengths", () => {
  test("handles fractional total seconds", () => {
    const state = sandProgress(1.25, 2.5);
    expect(state.fraction).toBeCloseTo(0.5, 10);
    expect(state.sourceFraction).toBeCloseTo(0.5, 10);
  });

  test("a very short sit (under one trip) uses a single trip", () => {
    expect(sandTripCount(5)).toBe(1);
    const state = sandProgress(2.5, 5);
    expect(state.fraction).toBe(0.5);
    expect(state.carrying).toBe(true);
    expect(state.carrierPosition).toBeCloseTo(0.5 / SAND_CARRY_SHARE, 10);
  });

  test("a sit of one second still completes cleanly", () => {
    expect(sandProgress(1, 1).complete).toBe(true);
  });

  test("a very long sit caps the trip count", () => {
    expect(sandTripCount(3 * 60 * 60)).toBe(SAND_MAX_TRIPS);
    expect(sandTripCount(SAND_SECONDS_PER_TRIP * SAND_MAX_TRIPS * 10)).toBe(SAND_MAX_TRIPS);
  });

  test("a three-hour sit keeps piles accurate", () => {
    const state = sandProgress(90 * 60, 3 * 60 * 60);
    expect(state.fraction).toBe(0.5);
    expect(state.sourceFraction).toBe(0.5);
  });

  test("a zero-length sit is complete rather than dividing by zero", () => {
    const state = sandProgress(0, 0);
    expect(state.complete).toBe(true);
    expect(Number.isFinite(state.carrierPosition)).toBe(true);
    expect(sandTripCount(0)).toBe(1);
  });
});
