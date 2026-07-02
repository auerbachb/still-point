import { describe, expect, it } from "vitest";
import {
  clampStepIndex,
  exerciseSummary,
  isLastStep,
  nextStepIndex,
  previousStepIndex,
  stepProgressFraction,
  totalDurationMs,
} from "./guidedExercise";
import { GUIDED_EXERCISES, guidedExerciseById } from "./guidedExerciseContent";

describe("guidedExerciseContent", () => {
  it("defines all three exercise modes", () => {
    const ids = GUIDED_EXERCISES.map(e => e.id);
    expect(ids).toEqual(["progressive-sensory", "breathing-awareness", "body-scan"]);
  });

  it("progressive sensory has five sense steps", () => {
    const exercise = guidedExerciseById("progressive-sensory");
    expect(exercise.steps).toHaveLength(5);
    expect(exercise.steps.map(s => s.id)).toEqual(["sight", "sound", "smell", "taste", "touch"]);
  });

  it("body scan walks through body regions", () => {
    const exercise = guidedExerciseById("body-scan");
    expect(exercise.steps.length).toBeGreaterThanOrEqual(8);
    expect(exercise.steps[0]?.title).toBe("Feet");
    expect(exercise.steps.at(-1)?.title).toBe("Whole body");
  });

  it("every step has positive duration for gentle pacing", () => {
    for (const exercise of GUIDED_EXERCISES) {
      for (const step of exercise.steps) {
        expect(step.durationMs).toBeGreaterThan(0);
        expect(step.prompt.length).toBeGreaterThan(10);
      }
    }
  });
});

describe("guidedExercise helpers", () => {
  const steps = guidedExerciseById("progressive-sensory").steps;

  it("totalDurationMs sums step durations", () => {
    expect(totalDurationMs(steps)).toBe(steps.reduce((n, s) => n + s.durationMs, 0));
  });

  it("clampStepIndex keeps index in range", () => {
    expect(clampStepIndex(-2, steps.length)).toBe(0);
    expect(clampStepIndex(2, steps.length)).toBe(2);
    expect(clampStepIndex(99, steps.length)).toBe(steps.length - 1);
  });

  it("next and previous step indices", () => {
    expect(nextStepIndex(0, steps.length)).toBe(1);
    expect(nextStepIndex(steps.length - 1, steps.length)).toBe(steps.length - 1);
    expect(previousStepIndex(0)).toBe(0);
    expect(previousStepIndex(2)).toBe(1);
  });

  it("isLastStep identifies the final prompt", () => {
    expect(isLastStep(steps.length - 2, steps.length)).toBe(false);
    expect(isLastStep(steps.length - 1, steps.length)).toBe(true);
  });

  it("stepProgressFraction tracks elapsed time within a step", () => {
    const step = steps[0]!;
    expect(stepProgressFraction(0, 0, step)).toBe(0);
    expect(stepProgressFraction(0, step.durationMs / 2, step)).toBe(0.5);
    expect(stepProgressFraction(0, step.durationMs, step)).toBe(1);
    expect(stepProgressFraction(0, step.durationMs * 2, step)).toBe(1);
  });

  it("exerciseSummary reports step count and total duration", () => {
    const summary = exerciseSummary("breathing-awareness");
    expect(summary.stepCount).toBe(5);
    expect(summary.totalDurationMs).toBe(totalDurationMs(guidedExerciseById("breathing-awareness").steps));
  });
});
